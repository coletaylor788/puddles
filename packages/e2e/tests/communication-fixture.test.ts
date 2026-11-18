import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
// @ts-expect-error Executable gateway fixture helper.
import { assertCommunicationGatewayRunning, communicationJsonRequest, ownedCommunicationContainers, runCommunicationHeartbeat } from "../fixtures/communication.mjs";

const heartbeatResponse = (details: unknown) => ({ httpStatus: 200, body: { ok: true, result: { details } } });

it("waits through native busy replies and requires a heartbeat to actually run", async () => {
  let calls = 0;
  const ran = heartbeatResponse({ status: "ran" });
  const value = await runCommunicationHeartbeat(async () => ++calls < 3
    ? heartbeatResponse({ status: "skipped", reason: "requests-in-flight" }) : ran, { retryMs: 1 });
  expect(calls).toBe(3);
  expect(value).toBe(ran);
});

it.each([
  heartbeatResponse({ status: "skipped", reason: "disabled" }),
  heartbeatResponse({ status: "failed", reason: "model failure" }),
  { httpStatus: 503, body: { ok: false } },
  { httpStatus: 200, body: { ok: false } },
  { httpStatus: 200, body: { ok: true, result: { isError: true, details: { status: "ran" } } } },
])("does not retry or accept other heartbeat failures: %j", async response => {
  let calls = 0;
  await expect(runCommunicationHeartbeat(async () => { calls++; return response; })).rejects.toThrow();
  expect(calls).toBe(1);
});

it("fails a persistently busy heartbeat within its original request budget", async () => {
  const budgets: number[] = [];
  await expect(runCommunicationHeartbeat(async (remaining: number) => {
    budgets.push(remaining);
    return heartbeatResponse({ status: "skipped", reason: "requests-in-flight" });
  }, { timeoutMs: 40, retryMs: 5 })).rejects.toThrow("Native heartbeat remained busy");
  expect(budgets.length).toBeGreaterThan(0);
  expect(budgets.every(value => value > 0 && value <= 40)).toBe(true);
});

it("surfaces gateway or model failures while waiting for heartbeat admission", async () => {
  let calls = 0;
  await expect(runCommunicationHeartbeat(async () => {
    calls++;
    return heartbeatResponse({ status: "skipped", reason: "requests-in-flight" });
  }, { check() { if (calls) throw new Error("Gateway exited"); } })).rejects.toThrow("Gateway exited");
  expect(calls).toBe(1);
});

it("bounds a tool response that stalls after sending JSON headers", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.flushHeaders();
    response.write('{"pending":');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  try {
    await expect(communicationJsonRequest(`http://127.0.0.1:${address.port}`, {}, 100)).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("reports a gateway signal exit instead of a missing native reply", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(child, "spawn");
    expect(() => assertCommunicationGatewayRunning(child, "main reply")).not.toThrow();
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    expect(child.exitCode).toBeNull();
    expect(() => assertCommunicationGatewayRunning(child, "watcher follow-up")).toThrow(
      "Gateway exited during watcher follow-up: SIGKILL",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

it("reports an unsuccessful gateway startup exit", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" });
  await once(child, "exit");
  expect(() => assertCommunicationGatewayRunning(child, "startup")).toThrow(
    "Gateway exited during startup: exit code 7",
  );
});

it("finds shortened sandbox names by fixture workspace and excludes foreign containers", () => {
  const root = "/tmp/communication-fixture";
  const container = (id: string, source: string, destination = "/workspace", sandbox = "1") => ({
    Id: id, Name: "/communi-workspace-shortened", Config: { Labels: { "openclaw.sandbox": sandbox } },
    Mounts: [{ Type: "bind", Source: source, Destination: destination }],
  });
  const watcher = container("watcher", `${root}/main/communication-watcher`);
  const reader = container("reader", `${root}/reader`, "/agent");
  const entries = [watcher, reader,
    container("other-run", `${root}-other/main`),
    container("parent", "/tmp"),
    container("unrelated-mount", `${root}/data`, "/data"),
    container("not-sandbox", `${root}/main`, "/workspace", "0"),
    { Id: "empty" },
  ];
  expect(ownedCommunicationContainers(entries, root)).toEqual([watcher, reader]);
  expect(ownedCommunicationContainers([], root)).toEqual([]);
});
