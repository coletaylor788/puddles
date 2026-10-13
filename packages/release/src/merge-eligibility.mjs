import { jsonDigest } from "./native-state.mjs";
import { verifyBuildReceipt, verifySourceGate } from "./native-release.mjs";

export function createMergeEligibility(build, sourceGate, dev) {
  const receipt = { schema: "puddles.merge-eligibility/v1", schemaVersion: 1,
    repository: build.repository, evidence: { build, sourceGate, dev } };
  receipt.sha256 = jsonDigest(receipt);
  return verifyMergeEligibility(receipt);
}

export function verifyMergeEligibility(receipt) {
  if (receipt?.schema !== "puddles.merge-eligibility/v1" || receipt.schemaVersion !== 1) {
    throw new Error("A pre-merge eligibility receipt is required");
  }
  const { sha256, ...identity } = receipt;
  if (sha256 !== jsonDigest(identity)) throw new Error("Merge eligibility evidence changed");
  const { build, sourceGate, dev } = receipt.evidence ?? {};
  verifyBuildReceipt(build);
  verifySourceGate(sourceGate, build.buildId);
  if (!/^[a-f0-9]{40}$/.test(receipt.repository?.head ?? "") ||
      !/^[a-f0-9]{40}$/.test(receipt.repository?.tree ?? "") ||
      jsonDigest(receipt.repository) !== jsonDigest(build.repository) ||
      dev?.schema !== "puddles.dev-validation/v1" || dev.status !== "passed" ||
      dev.head !== build.repository.head || dev.tree !== build.repository.tree ||
      typeof dev.evidence !== "string" || !dev.evidence ||
      typeof dev.owner !== "string" || !dev.owner) {
    throw new Error("DEV validation must cover the exact reviewed source");
  }
  return receipt;
}
