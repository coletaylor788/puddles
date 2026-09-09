import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) {
  throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
}

describe("materialized fs-safe stale reclaim guard", () => {
  it("retains the upstream guard across stale reclaim and replacement admission", () => {
    const sidecarLock = readFileSync(
      join(
        candidate,
        "node_modules",
        "@openclaw",
        "fs-safe",
        "dist",
        "sidecar-lock-acquire.js",
      ),
      "utf8",
    );

    const kernelGuard = readFileSync(
      join(candidate, "node_modules/@openclaw/fs-safe/dist/reclaim-kernel-guard.js"),
      "utf8",
    );
    expect(kernelGuard).toContain("DARWIN_O_EXLOCK = 32");
    expect(kernelGuard).toContain("fs.constants.O_NONBLOCK");
    expect(sidecarLock).toContain("tryAcquireSidecarReclaimGuard");
    expect(sidecarLock).toContain("sidecarReclaimGuardExists(reclaimGuardPath)");
    expect(sidecarLock).toContain("releaseSidecarReclaimGuard(context.reclaimGuards, reclaimGuardPath)");
  });
});
