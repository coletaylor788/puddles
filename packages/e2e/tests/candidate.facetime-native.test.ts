import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Maintained native patch functions are exercised at runtime.
import { prepareFaceTimeNative, buildFaceTimeNative } from "../src/facetime-native-patches.mjs";

it("replays the pinned native patch and executes shared-answer and carrier-closure regressions", { timeout: 300_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "puddles-facetime-native-"));
  const source = join(root, "source");
  try {
    const { receipt: identity, dylib } = await buildFaceTimeNative(source, process.env.FACETIME_NATIVE_SOURCE);
    expect(identity.patches).toHaveLength(1);
    expect(identity.tree).toMatch(/^[a-f0-9]{40}$/);
    expect(identity).toMatchObject({ schemaVersion: 2, kind: "source-built", configuration: "release", signing: "ad-hoc" });
    expect(identity.helperSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(dylib).includes(Buffer.from(identity.buildId))).toBe(true);
    // Reusing a populated destination must fail without removing its existing source.
    const receipt = readFileSync(join(source, "puddles-native-source.json"), "utf8");
    await expect(prepareFaceTimeNative(source)).rejects.toThrow();
    expect(readFileSync(join(source, "puddles-native-source.json"), "utf8")).toBe(receipt);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
