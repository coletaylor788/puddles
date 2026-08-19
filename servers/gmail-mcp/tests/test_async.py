"""Tests for the async wrapper around blocking google-api calls."""

import asyncio
import io
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import anyio
import pytest

from gmail_mcp import _async


@pytest.mark.asyncio
async def test_run_blocking_returns_value():
    result = await _async.run_blocking(lambda: 42, op="unit.echo")
    assert result == 42


@pytest.mark.asyncio
async def test_run_blocking_propagates_exception():
    class Boom(RuntimeError):
        pass

    def boom():
        raise Boom("nope")

    with pytest.raises(Boom):
        await _async.run_blocking(boom, op="unit.boom")


@pytest.mark.asyncio
async def test_run_blocking_times_out(monkeypatch):
    """A call that exceeds timeout raises asyncio.TimeoutError and logs api_timeout."""
    captured = io.StringIO()
    monkeypatch.setattr(sys, "stderr", captured)

    def slow():
        time.sleep(0.5)
        return "late"

    with pytest.raises(asyncio.TimeoutError):
        await _async.run_blocking(slow, op="unit.slow", timeout=0.05)

    events = [json.loads(line) for line in captured.getvalue().splitlines() if line.strip()]
    timeout_events = [e for e in events if e["event"] == "api_timeout"]
    assert len(timeout_events) == 1
    assert timeout_events[0]["op"] == "unit.slow"
    assert timeout_events[0]["timeout_s"] == 0.05


@pytest.mark.asyncio
async def test_run_blocking_cancels_work_still_queued_at_timeout(monkeypatch):
    """Executor saturation cannot start a side effect after timeout."""
    loop = asyncio.get_running_loop()
    executor = ThreadPoolExecutor(max_workers=1)
    release_worker = threading.Event()
    late_call_started = threading.Event()
    occupied = loop.run_in_executor(executor, release_worker.wait)

    async def saturated_to_thread(call):
        return await loop.run_in_executor(executor, call)

    monkeypatch.setattr(_async.asyncio, "to_thread", saturated_to_thread)
    try:
        with pytest.raises(asyncio.TimeoutError):
            await _async.run_blocking(
                late_call_started.set,
                op="unit.queued",
                timeout=0.05,
            )
    finally:
        release_worker.set()
        await occupied
        await asyncio.sleep(0.05)
        executor.shutdown(wait=True)

    assert not late_call_started.is_set()


@pytest.mark.asyncio
async def test_run_blocking_cancels_work_still_queued_by_caller(monkeypatch):
    """Caller cancellation cannot leave queued side effects behind."""
    loop = asyncio.get_running_loop()
    executor = ThreadPoolExecutor(max_workers=1)
    release_worker = threading.Event()
    late_call_started = threading.Event()
    cancellation = threading.Event()
    occupied = loop.run_in_executor(executor, release_worker.wait)

    async def saturated_to_thread(call):
        return await loop.run_in_executor(executor, call)

    monkeypatch.setattr(_async.asyncio, "to_thread", saturated_to_thread)
    task = asyncio.create_task(
        _async.run_blocking(
            late_call_started.set,
            op="unit.cancelled",
            timeout=1,
            cancellation=cancellation,
        )
    )
    await asyncio.sleep(0)
    task.cancel()
    try:
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release_worker.set()
        await occupied
        await asyncio.sleep(0.05)
        executor.shutdown(wait=True)

    assert cancellation.is_set()
    assert not late_call_started.is_set()


@pytest.mark.asyncio
async def test_cancellation_drains_started_authentication_write():
    """Cancellation is not returned before a bounded credential write finishes."""
    write_started = threading.Event()
    release_write = threading.Event()
    write_finished = threading.Event()
    cancellation = threading.Event()

    def credential_write():
        write_started.set()
        release_write.wait(timeout=1)
        write_finished.set()

    task = asyncio.create_task(
        _async.run_blocking(
            credential_write,
            op="unit.credential_write",
            timeout=1,
            cancellation=cancellation,
        )
    )
    await asyncio.wait_for(asyncio.to_thread(write_started.wait), timeout=0.5)
    task.cancel()
    await asyncio.sleep(0.05)
    assert not task.done()

    release_write.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert cancellation.is_set()
    assert write_finished.is_set()


@pytest.mark.asyncio
async def test_anyio_cancellation_drains_started_authentication_write():
    """AnyIO level cancellation cannot interrupt the bounded write drain."""
    write_started = threading.Event()
    release_write = threading.Event()
    write_finished = threading.Event()
    cancellation = threading.Event()

    def credential_write():
        write_started.set()
        release_write.wait(timeout=1)
        write_finished.set()

    async def run_write():
        await _async.run_blocking(
            credential_write,
            op="unit.anyio_credential_write",
            timeout=1,
            cancellation=cancellation,
        )

    release_timer = threading.Timer(0.1, release_write.set)
    async with anyio.create_task_group() as task_group:
        task_group.start_soon(run_write)
        await asyncio.wait_for(asyncio.to_thread(write_started.wait), timeout=0.5)
        release_timer.start()
        task_group.cancel_scope.cancel()

    release_timer.join(timeout=1)
    assert cancellation.is_set()
    assert write_finished.is_set()


@pytest.mark.asyncio
async def test_run_blocking_does_not_block_event_loop():
    """While a blocking call sleeps in a worker thread, the event loop must stay responsive."""
    counter = {"n": 0}

    async def ticker():
        for _ in range(20):
            await asyncio.sleep(0.005)
            counter["n"] += 1

    def blocking():
        time.sleep(0.2)
        return "done"

    ticker_task = asyncio.create_task(ticker())
    result = await _async.run_blocking(blocking, op="unit.block", timeout=5.0)
    await ticker_task

    assert result == "done"
    # The event loop processed the ticker concurrently while the worker thread slept.
    # If run_blocking had blocked the loop we'd see ~0 ticks; we expect ~20.
    assert counter["n"] >= 10


@pytest.mark.asyncio
async def test_slow_call_warning_emitted(monkeypatch):
    """slow_call warning fires at the configured threshold while a call is in flight."""
    captured = io.StringIO()
    monkeypatch.setattr(sys, "stderr", captured)
    monkeypatch.setattr(_async, "SLOW_CALL_THRESHOLDS_S", (0.05,))

    def slow():
        time.sleep(0.15)
        return "ok"

    result = await _async.run_blocking(slow, op="unit.slowwarn", timeout=2.0)
    assert result == "ok"

    events = [json.loads(line) for line in captured.getvalue().splitlines() if line.strip()]
    slow_events = [e for e in events if e["event"] == "slow_call"]
    assert len(slow_events) == 1
    assert slow_events[0]["op"] == "unit.slowwarn"
    assert slow_events[0]["threshold_s"] == 0.05


@pytest.mark.asyncio
async def test_logs_api_call_and_done_on_success(monkeypatch):
    captured = io.StringIO()
    monkeypatch.setattr(sys, "stderr", captured)

    await _async.run_blocking(
        lambda: {"messages": [{"id": "a"}, {"id": "b"}, {"id": "c"}]},
        op="messages.list",
    )

    events = [json.loads(line) for line in captured.getvalue().splitlines() if line.strip()]
    kinds = [e["event"] for e in events]
    assert "api_call" in kinds
    assert "api_done" in kinds
    done = next(e for e in events if e["event"] == "api_done")
    assert done["op"] == "messages.list"
    assert done["result_size"] == 3
