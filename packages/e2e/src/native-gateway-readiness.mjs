import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

// Use the caller's original startup deadline, including time spent waiting for
// channel subscription. This gate never retries an application tool request.
export async function waitForNativeGatewayReadiness({
  port, deadline, assertAlive, endpoint = "/readyz", fetchHealth = fetch,
  now = () => performance.now(), pause = delay,
}) {
  assert.ok(["/readyz", "/startupz"].includes(endpoint), "Unknown native Gateway probe");
  while (now() < deadline) {
    assertAlive();
    let ready = false;
    try {
      const response = await fetchHealth(`http://127.0.0.1:${port}${endpoint}`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(1000, Math.floor(deadline - now())))),
      });
      await response.body?.cancel();
      ready = response.status === 200;
    } catch (error) {
      // Listener connection races and bounded probe timeouts are not readiness.
      if (!(error instanceof TypeError) && !["TimeoutError", "AbortError"].includes(error?.name)) throw error;
    }
    assertAlive();
    if (ready && now() < deadline) return;
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(100, remaining));
  }
  throw new Error(`Installed fixture timed out: native agent database readiness (${endpoint})`);
}
