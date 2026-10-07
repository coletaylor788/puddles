import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
// @ts-expect-error Executable gateway fixture helper.
import { assertCommunicationGatewayRunning, ownedCommunicationContainers } from "../fixtures/communication.mjs";

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
