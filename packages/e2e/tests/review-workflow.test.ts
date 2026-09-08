import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const instructions = readFileSync(resolve(root, ".github/copilot-instructions.md"), "utf8");
const workflow = readFileSync(resolve(root, ".github/skills/safe-feature-development/SKILL.md"), "utf8");
const review = readFileSync(resolve(root, ".github/skills/adversarial-review/SKILL.md"), "utf8");

describe("native engineering ownership and retained review", () => {
  it("preserves clear explanations for readers unfamiliar with OpenClaw internals", () => {
    for (const document of [instructions, workflow]) {
      expect(document).toMatch(/experienced software engineer[\s\S]*does not know OpenClaw's internals or vocabulary/i);
      expect(document).toMatch(/When OpenClaw is relevant[\s\S]*what it does[\s\S]*request or runtime flow/i);
      expect(document).toMatch(/Do not add unrelated\s+internals or a general tutorial/i);
    }
    expect(workflow).toMatch(/Use familiar agent-system ideas\s+as a bridge/i);
    expect(workflow).toMatch(/do not rely on its internal names as shorthand/i);
  });

  it("keeps one independent reviewer through complete-diff remediation", () => {
    expect(workflow).toMatch(/retain its worker handle/i);
    expect(workflow).toMatch(/resume that same reviewer/i);
    expect(workflow).toMatch(/re-check the complete\s+current diff/i);
    expect(workflow).toMatch(/fails or cannot be resumed[\s\S]*independent replacement/i);
    expect(workflow).toMatch(/Do not launch a terminal fresh reviewer for routine bookkeeping/i);
    expect(workflow).toMatch(/Updating status or recording evidence does not restart review/i);
    expect(review).toMatch(/When resumed after remediation/i);
    expect(review).toMatch(/Verify each\s+claimed correction/i);
    expect(review).toMatch(/re-check the complete\s+current diff/i);
    expect(review).toMatch(/Do not repeat a resolved finding/i);
  });

  it("suppresses speculative minor findings without hiding material defects", () => {
    expect(workflow).toMatch(/Triage every finding using engineering judgment/i);
    expect(workflow).toMatch(/do not make churn changes/i);
    expect(workflow).toMatch(/significant finding you dispute[\s\S]*resume the same reviewer/i);
    expect(workflow).toMatch(/accepted fix, a revised finding, a withdrawal/i);
    expect(workflow).toMatch(/escalate it for a decision instead of\s+repeating review cycles/i);
    expect(review).toMatch(/Do not manufacture findings/i);
    expect(review).toMatch(/Do not report minor or low-severity concerns/i);
    expect(review).toMatch(/concrete failure scenario with\s+material impact/i);
    expect(review).toMatch(/residual validation gap,\s+not as a defect/i);
    expect(review).toMatch(/Withdraw or revise a finding/i);
    expect(review).toMatch(/do not defend it merely for consistency/i);
    expect(review).toMatch(/material requirements that are missing, only partially implemented, or\s+contradicted/i);
    expect(review).toMatch(/material defects in documentation, tests, and configuration/i);
  });

  it("uses a single repair loop and integrates before the live rollback transaction", () => {
    for (const document of [instructions, workflow]) {
      expect(document).toMatch(/One engineering owner/i);
      expect(document).toMatch(/Scripts own\s+commands and durable/i);
      expect(document).toMatch(/committed\s+regressions/i);
      expect(document).toMatch(/No GitHub merge[\s\S]*live[\s\S]*rollback transaction/i);
    }
    expect(workflow.indexOf("5. **Validate and rehearse")).toBeLessThan(workflow.indexOf("6. **Integrate eligible"));
    expect(workflow.indexOf("6. **Integrate eligible")).toBeLessThan(workflow.indexOf("7. **Activate exact"));
    expect(workflow).toMatch(/without rebuilding, repackaging,\s+dependency fetching/i);
    expect(workflow).toMatch(/tests, environment,\s+toolchain, build inputs, and output digests/i);
    expect(workflow).toMatch(/package correction reruns\s+installation and runtime proofs, not unchanged source tests/i);
    expect(workflow).toMatch(/Honor an explicit implementation-only handoff/i);
    expect(workflow).toMatch(/Do not stop at an open pull request/i);
  });

  it("keeps the approved design checkpoint without routine requester handoffs", () => {
    expect(instructions).toMatch(/Pause at design only when the requester explicitly asks/i);
    expect(workflow).toMatch(/Pause before implementation only when the requester explicitly asks/i);
    expect(workflow).toMatch(/Otherwise, do not\s+add a human approval gate/i);
    expect(workflow).toMatch(/approved implementation request as authorization/i);
    expect(workflow).toMatch(/controlling instruction may explicitly stop or\s+limit/i);
    expect(workflow).toMatch(/requester's final validation\s+and external task-completion decision/i);
  });

  it("requires self-contained actionable help only after autonomous paths are exhausted", () => {
    const help = workflow.slice(workflow.indexOf("## Requesting requester help"), workflow.indexOf("## Required loop"));
    expect(help).toMatch(/only after normal autonomous resolution paths are\s+exhausted/i);
    expect(help).toMatch(/Before asking, update the plan and the\s+issue status with the blocker/i);
    expect(help).toMatch(/must be concise and self-contained/i);
    expect(help).toMatch(/name the exact blocker/i);
    expect(help).toMatch(/relevant evidence[\s\S]*already tried or\s+verified/i);
    expect(help).toMatch(/cannot safely or correctly resolve it without the\s+requester/i);
    expect(help).toMatch(/one exact decision, fact, permission, configuration change, or action/i);
    expect(help).toMatch(/what the worker will do after the answer/i);
    expect(help).toMatch(/Include the tracking issue/i);
    expect(help).toMatch(/continue\s+investigating instead of asking/i);
  });

  it("distinguishes deterministic fixture assertions from opt-in read-only host checks", () => {
    expect(workflow).toMatch(/real\s+installed OpenClaw|real installed OpenClaw/i);
    expect(workflow).toMatch(/Missing adapters fail setup; there is no\s+live fallback/i);
    expect(workflow).toMatch(/deterministic read fixtures for content assertions/i);
    expect(workflow).toMatch(/host health checks are bounded and read-only/i);
    expect(workflow).toMatch(/Required unavailable checks fail/i);
    expect(workflow).toMatch(/Public CI needs no live credentials/i);
    expect(workflow).toMatch(/not a security sandbox or a VM/i);
  });
});
