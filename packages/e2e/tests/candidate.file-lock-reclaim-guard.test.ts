import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) {
  throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
}

describe("materialized fs-safe stale reclaim guard", () => {
  it("contains the macOS kernel-exclusive reclaim guard", () => {
    const sidecarLock = readFileSync(
      join(
        candidate,
        "node_modules",
        "@openclaw",
        "fs-safe",
        "dist",
        "sidecar-lock.js",
      ),
      "utf8",
    );

    expect(sidecarLock).toContain("DARWIN_O_EXLOCK = 32");
    expect(sidecarLock).toContain("acquireStaleReclaimGuard");
    expect(sidecarLock).toContain("await acquireStaleReclaimGuard(lockPath)");
  });
});
