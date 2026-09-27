import { expect, it } from "vitest";
// @ts-expect-error Executable gateway fixture helper.
import { ownedCommunicationContainers } from "../fixtures/communication.mjs";

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
