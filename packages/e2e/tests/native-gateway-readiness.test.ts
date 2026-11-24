import assert from "node:assert/strict";
import { it as test } from "vitest";
// @ts-expect-error Native lifecycle helpers are executable JavaScript.
import { waitForNativeGatewayReadiness } from "../src/native-gateway-readiness.mjs";

function fixture({ responses, started = 90_500, alive = () => {}, endpoint = "/readyz" }: { responses: (number | Error)[]; started?: number; alive?: () => void; endpoint?: string }) {
  let time = started, calls = 0, cancelled = 0;
  return {
    get time() { return time; }, get calls() { return calls; },
    get cancelled() { return cancelled; },
    wait: () => waitForNativeGatewayReadiness({
      port: 12345, deadline: 91_000, endpoint, now: () => time, assertAlive: alive,
      pause: async (ms: number) => { time += ms; },
      fetchHealth: async (url: string, { signal }: { signal: AbortSignal }) => {
        assert.equal(url, `http://127.0.0.1:12345${endpoint}`);
        assert.ok(signal instanceof AbortSignal);
        const value = responses[Math.min(calls++, responses.length - 1)];
        if (value instanceof Error) throw value;
        return { status: value, body: { cancel: async () => { cancelled++; } } };
      },
    }),
  };
}

test("channel subscription does not release tools before native agent admission", async () => {
  const f = fixture({ responses: [503, new DOMException("probe", "TimeoutError"), new TypeError("fetch failed"), 200] });
  let toolsAllowed = false;
  await f.wait().then(() => { toolsAllowed = true; });
  assert.equal(toolsAllowed, true);
  assert.equal(f.calls, 4);
  assert.equal(f.cancelled, 2);
  assert.equal(f.time, 90_800);
});

test("unready responses and transport failures share the remaining startup budget", async () => {
  for (const response of [503, new TypeError("connection refused"), new DOMException("probe", "AbortError")]) {
    const f = fixture({ responses: [response], started: 90_850 });
    await assert.rejects(f.wait(), /native agent database readiness/);
    assert.equal(f.time, 91_000);
    assert.equal(f.calls, 2);
  }
});

test("expired original startup deadline does not start another probe", async () => {
  const f = fixture({ responses: [200], started: 91_000 });
  await assert.rejects(f.wait(), /timed out/);
  assert.equal(f.calls, 0);
});

test("model errors and child exit remain immediate failures, even after a successful probe", async () => {
  for (const failure of [new Error("model failed"), new Error("Gateway exited")]) {
    for (const failOn of [1, 2]) {
      let checks = 0;
      const f = fixture({ responses: [200], alive: () => { if (++checks === failOn) throw failure; } });
      await assert.rejects(f.wait(), (error: unknown) => error === failure);
      assert.equal(f.calls, failOn - 1);
    }
  }
});

test("unexpected probe errors are not hidden", async () => {
  const failure = new Error("unexpected probe failure");
  const f = fixture({ responses: [failure] });
  await assert.rejects(f.wait(), (error: unknown) => error === failure);
  assert.equal(f.calls, 1);
});


test("each startup gate waits for native settlement before releasing ingress", async () => {
  for (let restart = 0; restart < 2; restart++) {
    const f = fixture({ responses: [503, 503, 200], endpoint: "/startupz" });
    let ingress = false;
    await f.wait().then(() => { ingress = true; });
    assert.equal(ingress, true);
    assert.equal(f.calls, 3);
  }
});

test("startup refusal and draining exhaust the shared deadline without releasing ingress", async () => {
  const f = fixture({ responses: [503], endpoint: "/startupz", started: 90_850 });
  await assert.rejects(f.wait(), /startupz/);
  assert.equal(f.time, 91_000);
  assert.equal(f.calls, 2);
});

test("unknown probe paths are rejected before any request", async () => {
  const f = fixture({ responses: [200], endpoint: "/healthz" });
  await assert.rejects(f.wait(), /Unknown native Gateway probe/);
  assert.equal(f.calls, 0);
});
