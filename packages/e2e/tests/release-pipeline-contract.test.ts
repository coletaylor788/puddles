import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const release = readFileSync(
  resolve(repoRoot, "packages/e2e/bin/openclaw-release.mjs"),
  "utf8",
);
const deploy = readFileSync(
  resolve(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh"),
  "utf8",
);

describe("OpenClaw release pipeline contract", () => {
  it("uses the locked private apply and validate argv", () => {
    expect(release).toMatch(
      /"apply",[\s\S]*"--source",[\s\S]*"--public-result",[\s\S]*"--output",[\s\S]*"--expected-private-head"/,
    );
    expect(release).toMatch(
      /"validate",[\s\S]*"--source",[\s\S]*"--public-result",[\s\S]*"--overlay-result",[\s\S]*"--output",[\s\S]*"--expected-private-head"/,
    );
    expect(release).toContain("candidateTreeSha256(candidate)");
    expect(release).toContain('stage: "public-validation"');
    expect(release).toContain('schemaVersion: 1');
  });

  it("packages once and deploys only the recorded artifact digest", () => {
    expect(release).toContain("const packed =");
    expect(release).toContain("OPENCLAW_ARTIFACT_SHA256");
    expect(deploy).toContain("Using immutable validated artifact");
    expect(deploy).toContain("transferred artifact digest does not match");
    expect(deploy).toMatch(
      /if \[ -n "\$OPENCLAW_ARTIFACT" \]; then[\s\S]*TARBALL="\$OPENCLAW_ARTIFACT"[\s\S]*else[\s\S]*run_pnpm build/,
    );
  });

  it("keeps production validation inside rollback ownership and lands durably after it", () => {
    const health = deploy.indexOf("wait_for_gateway || rollback_and_exit");
    const postCheck = deploy.indexOf('"$POST_DEPLOY_CHECK" ||');
    const releaseRollback = deploy.indexOf(
      '"post-deploy validation or landing check failed"',
    );
    const releaseOwnership = deploy.lastIndexOf("GATEWAY_QUIESCED=0");
    expect(postCheck).toBeGreaterThan(health);
    expect(releaseRollback).toBeGreaterThan(postCheck);
    expect(releaseOwnership).toBeGreaterThan(releaseRollback);
    const productionReceipt = release.indexOf("productionReceipt");
    const landStage = release.indexOf('"land"');
    expect(productionReceipt).toBeGreaterThan(0);
    expect(landStage).toBeGreaterThan(productionReceipt);
    expect(release).toContain("--match-head-commit");
    expect(release).toContain("exact candidate was not confirmed landed");
  });

  it("sets non-interactive SSH identity and control connection defaults", () => {
    expect(deploy).toContain("-o BatchMode=yes");
    expect(deploy).toContain("-o IdentitiesOnly=yes");
    expect(deploy).toContain("-o ControlMaster=auto");
    expect(deploy).toContain("-o ControlPersist=600");
    expect(deploy).toContain("ControlPath=$SSH_CONTROL_PATH");
  });

  it("detaches remote deployment and reconciles a pinned durable receipt", () => {
    expect(deploy).toContain("nohup /bin/bash");
    expect(deploy).toContain("REMOTE_RESULT_ATTEMPTS");
    expect(deploy).toContain("REMOTE_RESULT_INTERVAL_SECONDS");
    expect(deploy).toContain("Reconciled completed remote deployment");
    expect(deploy).toContain(
      "remote deployment completion remains ambiguous after bounded receipt polling",
    );
    expect(deploy).toContain(
      "remote deployment receipt does not match the immutable artifact",
    );
  });

  it("requires remote checks for both pull requests before landing", () => {
    expect(release).toContain(
      'throw new Error("pull request checks are not all complete and successful")',
    );
    expect(release).toMatch(
      /private_state=[\s\S]*checks\.length === 0[\s\S]*private pull request changed after promotion/,
    );
  });
});
