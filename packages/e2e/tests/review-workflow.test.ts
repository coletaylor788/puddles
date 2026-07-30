import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const repoInstructions = readFileSync(
  resolve(repoRoot, ".github/copilot-instructions.md"),
  "utf8",
);
const safeWorkflow = readFileSync(
  resolve(repoRoot, ".github/skills/safe-feature-development/SKILL.md"),
  "utf8",
);
const reviewWorkflow = readFileSync(
  resolve(repoRoot, ".github/skills/adversarial-review/SKILL.md"),
  "utf8",
);

describe("adversarial review workflow", () => {
  it("reuses one reviewer throughout remediation without narrowing review", () => {
    expect(safeWorkflow).toContain('version: "1.6.0"');
    expect(safeWorkflow).toMatch(/retain its worker handle/i);
    expect(safeWorkflow).toMatch(/resume or restart that same reviewer/i);
    expect(safeWorkflow).toMatch(
      /which findings were addressed[\s\S]*what files or behavior\s+changed[\s\S]*which validation\s+reran/i,
    );
    expect(safeWorkflow).toMatch(/re-check the complete\s+current diff/i);
    expect(safeWorkflow).toMatch(
      /fails or cannot be resumed[\s\S]*fresh\s+independent replacement/i,
    );
    expect(safeWorkflow).not.toContain(
      "Then launch another fresh adversarial reviewer",
    );
    expect(safeWorkflow).toMatch(
      /terminal fresh review against that\s+exact commit/i,
    );
    expect(safeWorkflow).toMatch(
      /Triage every finding using engineering judgment/i,
    );
    expect(safeWorkflow).toMatch(/do not make churn changes/i);
    expect(safeWorkflow).toMatch(
      /significant finding you dispute[\s\S]*resume the same reviewer/i,
    );
    expect(safeWorkflow).toMatch(
      /converge on an accepted fix, a revised finding, a withdrawal/i,
    );
    expect(safeWorkflow).toMatch(
      /escalate it for a decision instead of\s+repeating review cycles/i,
    );
    expect(safeWorkflow).toMatch(/do not require a\s+new finding or code change/i);

    expect(reviewWorkflow).toContain('version: "1.3.0"');
    expect(reviewWorkflow).toMatch(/When resumed after remediation/i);
    expect(reviewWorkflow).toMatch(/Verify each\s+claimed correction/i);
    expect(reviewWorkflow).toMatch(/re-check the complete\s+current diff/i);
    expect(reviewWorkflow).toMatch(/Do not repeat a resolved finding/i);
    expect(reviewWorkflow).toMatch(/Do not manufacture findings/i);
    expect(reviewWorkflow).toMatch(/A\s+clean review is a normal, useful result/i);
    expect(reviewWorkflow).toMatch(/concrete failure scenario with\s+material impact/i);
    expect(reviewWorkflow).toMatch(/residual validation gap,\s+not as a defect/i);
    expect(reviewWorkflow).toMatch(/Withdraw or revise a finding/i);
    expect(reviewWorkflow).toMatch(/do not defend it merely for consistency/i);
  });

  it("suppresses minor findings without hiding material defects", () => {
    expect(reviewWorkflow).toMatch(
      /Do not report minor or low-severity concerns as findings/i,
    );
    expect(reviewWorkflow).toMatch(
      /Suppress style, wording, optional hardening,\s+low-impact proof gaps/i,
    );
    expect(reviewWorkflow).toMatch(
      /do not promote minor gaps\s+into actionable remediation-loop findings/i,
    );
    expect(reviewWorkflow).toMatch(
      /material requirements that are missing, only partially implemented, or\s+contradicted/i,
    );
    expect(reviewWorkflow).toMatch(
      /material correctness defects[\s\S]*unsafe\s+failure behavior/i,
    );
    expect(reviewWorkflow).toMatch(
      /material defects in documentation, tests, and configuration/i,
    );
    expect(reviewWorkflow).toMatch(
      /correctness, safety, security, requirement, lifecycle, or regression\s+risk/i,
    );
    expect(reviewWorkflow).toMatch(
      /residual validation gaps separately from findings/i,
    );
    expect(reviewWorkflow).toMatch(
      /Report only concrete, actionable, high-confidence findings/i,
    );
  });

  it("keeps design as the only optional checkpoint and lands agent-owned work", () => {
    const ownershipWorkflow = safeWorkflow.slice(
      safeWorkflow.indexOf("## Ownership and checkpoints"),
      safeWorkflow.indexOf("## Required loop"),
    );
    const remoteIntegrationWorkflow = safeWorkflow.slice(
      safeWorkflow.indexOf("6. **Prepare remote integration**"),
      safeWorkflow.indexOf("7. **Promote through the configured lifecycle**"),
    );
    const closeoutWorkflow = safeWorkflow.slice(
      safeWorkflow.indexOf("9. **Land and close out**"),
      safeWorkflow.indexOf("## Completion gate"),
    );

    expect(repoInstructions).toMatch(
      /approved implementation request authorizes the worker[\s\S]*commit, push[\s\S]*merge,[\s\S]*verify the landed result/i,
    );
    expect(repoInstructions).toMatch(
      /Pause at design only when the requester explicitly asks/i,
    );
    expect(repoInstructions).toMatch(
      /Do not hand routine\s+agent-owned pull-request review or merge work to the requester/i,
    );
    expect(repoInstructions).toMatch(
      /controlling instruction may explicitly limit[\s\S]*permissions and protections always apply/i,
    );

    expect(safeWorkflow).toMatch(
      /approved implementation request as authorization[\s\S]*commit, push[\s\S]*merge,[\s\S]*post-landing\s+verification/i,
    );
    expect(ownershipWorkflow).toMatch(
      /controlling instruction may explicitly stop or limit[\s\S]*permissions and protections always apply/i,
    );
    expect(safeWorkflow).toMatch(
      /Pause before implementation only when the requester explicitly asks/i,
    );
    expect(safeWorkflow).toMatch(
      /Otherwise, do not\s+add a human approval gate/i,
    );
    expect(safeWorkflow).toMatch(/6\. \*\*Prepare remote integration\*\*/);
    expect(safeWorkflow).toMatch(/9\. \*\*Land and close out\*\*/);
    expect(
      safeWorkflow.indexOf("6. **Prepare remote integration**"),
    ).toBeLessThan(
      safeWorkflow.indexOf("7. **Promote through the configured lifecycle**"),
    );
    expect(
      safeWorkflow.indexOf("7. **Promote through the configured lifecycle**"),
    ).toBeLessThan(
      safeWorkflow.indexOf("8. **Validate production and roll back on failure**"),
    );
    expect(
      safeWorkflow.indexOf("8. **Validate production and roll back on failure**"),
    ).toBeLessThan(safeWorkflow.indexOf("9. **Land and close out**"));
    expect(remoteIntegrationWorkflow).toMatch(
      /required remote checks[\s\S]*unresolved review threads[\s\S]*merge conflicts/i,
    );
    expect(closeoutWorkflow).toMatch(
      /Do not stop at an open pull request or a\s+`Ready for review` state/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /terminal-reviewed candidate is remotely green, mergeable, and has\s+no unresolved required review[\s\S]*exact head commit and the current\s+base-branch commit[\s\S]*Do not merge a candidate[\s\S]*promotion and production validation complete/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /Any candidate change invalidates the terminal review[\s\S]*applicable validation, full integration pool, retained-review recheck,[\s\S]*fresh terminal review[\s\S]*repeating\s+all remote integration gates/i,
    );
    expect(closeoutWorkflow).toMatch(
      /Immediately before merge[\s\S]*head and base are the exact remotely approved commits recorded before\s+promotion[\s\S]*head completed applicable promotion and production\s+validation/i,
    );
    expect(closeoutWorkflow).toMatch(
      /head, approved base, required checks or review, or mergeability\s+changed after promotion[\s\S]*roll back the promoted candidate[\s\S]*revalidate production health[\s\S]*update and\s+revalidate the candidate against the current base[\s\S]*restart at the\s+applicable review and remote-integration step/i,
    );
    expect(closeoutWorkflow).toMatch(
      /merge it using the repository's\s+configured method[\s\S]*After the merge command, re-fetch the pull request and default branch[\s\S]*exact candidate cannot be confirmed landed/i,
    );
    expect(safeWorkflow).toMatch(
      /exact candidate cannot be confirmed landed[\s\S]*roll back the promoted candidate[\s\S]*revalidate production health[\s\S]*preserve the landing failure[\s\S]*rollback failures as additional\s+errors[\s\S]*restart remote integration/i,
    );
    expect(safeWorkflow).toMatch(
      /Once landing is confirmed[\s\S]*default branch contains the expected\s+change[\s\S]*post-merge checks pass/i,
    );
    expect(closeoutWorkflow).toMatch(
      /requester's final validation and\s+external task-completion decision/i,
    );
    expect(closeoutWorkflow).toMatch(
      /Mark the repository issue complete and report the landed outcome[\s\S]*requester's final validation and\s+external task-completion decision/i,
    );
    expect(safeWorkflow).not.toMatch(/exact commit to be handed off/i);
  });

  it("requires clear and actionable requester-help escalations", () => {
    const helpWorkflow = safeWorkflow.slice(
      safeWorkflow.indexOf("## Requesting requester help"),
      safeWorkflow.indexOf("## Required loop"),
    );

    expect(helpWorkflow).toMatch(
      /only after normal autonomous resolution paths are\s+exhausted/i,
    );
    expect(helpWorkflow).toMatch(
      /Before asking, update the plan and\s+issue ledger with the blocker/i,
    );
    expect(helpWorkflow).toMatch(/must be concise and self-contained/i);
    expect(helpWorkflow).toMatch(
      /name the exact blocker[\s\S]*affected feature, environment, or lifecycle\s+step/i,
    );
    expect(helpWorkflow).toMatch(
      /relevant evidence[\s\S]*already tried or\s+verified/i,
    );
    expect(helpWorkflow).toMatch(
      /explain why the worker cannot safely or correctly resolve it without the\s+requester/i,
    );
    expect(helpWorkflow).toMatch(
      /ask for one exact decision, fact, permission, configuration change, or action/i,
    );
    expect(helpWorkflow).toMatch(
      /what the worker will do after the answer[\s\S]*material consequence/i,
    );
    expect(helpWorkflow).toMatch(/Include the tracking issue/i);
    expect(helpWorkflow).toMatch(
      /Never send a vague status-shaped question[\s\S]*unexplained subsystem[\s\S]*"enabled"/i,
    );
    expect(helpWorkflow).toMatch(
      /delegate routine worker-owned design execution, review, CI,[\s\S]*merge, landing, or verification/i,
    );
    expect(helpWorkflow).toMatch(
      /cannot be described clearly enough[\s\S]*continue\s+investigating instead of asking/i,
    );
    expect(safeWorkflow).toMatch(
      /ask the exact unresolved\s+design question using the requester-help contract above/i,
    );
    expect(safeWorkflow).toMatch(
      /requester input is genuinely required[\s\S]*use the requester-help contract\s+above/i,
    );
  });
});
