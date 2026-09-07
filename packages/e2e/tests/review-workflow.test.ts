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

describe("shared explanation workflow", () => {
  it("explains relevant OpenClaw context for an experienced software engineer", () => {
    const repoWriting = repoInstructions.slice(
      repoInstructions.indexOf("## Writing style"),
      repoInstructions.indexOf("## Development lifecycle"),
    );
    const skillWriting = safeWorkflow.slice(
      safeWorkflow.indexOf("## How to write"),
      safeWorkflow.indexOf("## Ownership and checkpoints"),
    );
    const planWorkflow = safeWorkflow.slice(
      safeWorkflow.indexOf("2. **Plan**"),
      safeWorkflow.indexOf("3. **Implement locally"),
    );

    for (const writing of [repoWriting, skillWriting]) {
      expect(writing).toMatch(
        /experienced software engineer[\s\S]*understands agent\s+systems[\s\S]*does not know OpenClaw's internals or vocabulary/i,
      );
      expect(writing).toMatch(
        /When OpenClaw is relevant[\s\S]*what it does[\s\S]*request or runtime flow[\s\S]*current decision/i,
      );
      expect(writing).toMatch(
        /enough context to reason about\s+the change without reading the source\s+first[\s\S]*Do not add unrelated\s+internals or a general tutorial/i,
      );
    }

    expect(skillWriting).toMatch(
      /Use familiar agent-system ideas\s+as a bridge[\s\S]*do not treat an internal name as an explanation/i,
    );
    expect(planWorkflow).toMatch(
      /When OpenClaw is\s+involved[\s\S]*do not rely on its internal names as shorthand[\s\S]*relevant part's job[\s\S]*request or runtime flow[\s\S]*why it\s+matters to this design/i,
    );
  });
});

describe("adversarial review workflow", () => {
  it("reuses one reviewer throughout remediation without narrowing review", () => {
    expect(safeWorkflow).toContain('version: "1.12.0"');
    expect(safeWorkflow).toMatch(/retain its worker handle/i);
    expect(safeWorkflow).toMatch(
      /only independent reviewer[\s\S]*Record its agent or session identity[\s\S]*durable run state/i,
    );
    expect(safeWorkflow).toMatch(/resume\s+that same reviewer/i);
    expect(safeWorkflow).toMatch(
      /which\s+findings were addressed[\s\S]*what files or\s+behavior changed[\s\S]*which validation reran/i,
    );
    expect(safeWorkflow).toMatch(/re-check\s+the complete\s+current diff/i);
    expect(safeWorkflow).toMatch(
      /fails or cannot be resumed[\s\S]*fresh\s+independent replacement only after recording the prior identity and\s+failure reason/i,
    );
    expect(safeWorkflow).toMatch(
      /Record the\s+replacement identity[\s\S]*complete-current-diff review/i,
    );
    expect(safeWorkflow).not.toContain(
      "Then launch another fresh adversarial reviewer",
    );
    expect(safeWorkflow).toMatch(/Do not launch a second terminal reviewer/i);
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
    expect(safeWorkflow).toMatch(/or require a new\s+finding or code change/i);

    expect(reviewWorkflow).toContain('version: "1.6.0"');
    expect(reviewWorkflow).toMatch(
      /single independent[\s\S]*pull-request review\s+process/i,
    );
    expect(reviewWorkflow).toMatch(
      /implementation worker's single independent[\s\S]*Do not invoke this skill\s+from the validation and deployment worker/i,
    );
    expect(reviewWorkflow).toMatch(
      /records this reviewer's identity[\s\S]*resumes the same identity after remediation/i,
    );
    expect(reviewWorkflow).toMatch(
      /replacement only when this reviewer failed or is irrecoverably\s+unavailable[\s\S]*record both identities and the failure[\s\S]*complete current diff/i,
    );
    expect(reviewWorkflow).toMatch(
      /Do not require a separate terminal reviewer/i,
    );
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

  it("keeps design as the only optional checkpoint and separates implementation from release execution", () => {
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
    const validationWorkflow = safeWorkflow.slice(
      safeWorkflow.indexOf("4. **Validate and iterate**"),
      safeWorkflow.indexOf("5. **Audit the full change**"),
    );

    expect(repoInstructions).toMatch(
      /implementation worker[\s\S]*code, configuration, documentation[\s\S]*retained independent review[\s\S]*commit, push[\s\S]*remote checks/i,
    );
    expect(repoInstructions).toMatch(
      /parent orchestrator owns worker creation and failure routing[\s\S]*Neither child creates or directly delegates\s+to the other/i,
    );
    expect(repoInstructions).toMatch(
      /implementation worker[\s\S]*reports the immutable repository,[\s\S]*argv array with a separate environment map[\s\S]*parent orchestrator, then stops and waits[\s\S]*does not promote or create the validation[\s\S]*deployment worker/i,
    );
    expect(repoInstructions).toMatch(
      /validation and deployment worker[\s\S]*must not edit files[\s\S]*invoke review, or create workers/i,
    );
    expect(repoInstructions).toMatch(
      /reports the failed stage to the parent orchestrator[\s\S]*parent routes the\s+evidence to the same implementation worker/i,
    );
    expect(repoInstructions).toMatch(
      /stage reuse is allowed only when recorded input and\s+output hashes still match/i,
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
      /approved implementation request as authorization for the implementation\s+worker[\s\S]*commit, push[\s\S]*remote checks/i,
    );
    expect(ownershipWorkflow).toMatch(
      /controlling\s+instruction may explicitly stop or limit[\s\S]*permissions and protections always apply/i,
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
    expect(remoteIntegrationWorkflow).toMatch(
      /Report the immutable handoff to the parent orchestrator,[\s\S]*then stop and wait/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /repository and pull request[\s\S]*exact public\s+head and base head[\s\S]*required check results[\s\S]*private head and manifest inputs[\s\S]*release argv and input paths[\s\S]*separate environment map[\s\S]*rollback prerequisites/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /Never hand off a pasted shell command with\s+inline environment assignments or PATH construction/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /implementation worker must not start promotion or create the validation\s+and deployment worker/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /parent orchestrator alone creates exactly one\s+distinct sibling validation and deployment worker/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /parent orchestrator and validation and deployment worker must not\s+create review agents/i,
    );
    expect(closeoutWorkflow).toMatch(
      /Do not stop at an open pull request or a\s+`Ready for review` state/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /retained-review candidate is remotely green, mergeable, and has\s+no unresolved required review[\s\S]*exact head commit and the current\s+base-branch commit/i,
    );
    expect(remoteIntegrationWorkflow).toMatch(
      /Any candidate change invalidates the retained review result[\s\S]*targeted checks while batching all fixes[\s\S]*full integration\s+pool once on the final candidate[\s\S]*resume the retained reviewer before\s+pushing and repeating remote integration gates/i,
    );
    expect(closeoutWorkflow).toMatch(
      /Immediately before merge[\s\S]*head and base are the exact remotely approved commits recorded before\s+promotion[\s\S]*head completed applicable promotion and production\s+validation/i,
    );
    expect(closeoutWorkflow).toMatch(
      /head, approved base, required checks or review, or mergeability\s+changed after promotion[\s\S]*roll back the promoted candidate[\s\S]*revalidate production health[\s\S]*report to the parent orchestrator[\s\S]*same implementation worker[\s\S]*updates and revalidates/i,
    );
    expect(closeoutWorkflow).toMatch(
      /merge it using the repository's\s+configured method[\s\S]*After the merge command, re-fetch the pull request and default branch[\s\S]*exact candidate cannot be confirmed landed/i,
    );
    expect(safeWorkflow).toMatch(
      /exact candidate cannot be confirmed landed[\s\S]*roll back the promoted candidate[\s\S]*revalidate production health[\s\S]*preserve the landing failure[\s\S]*rollback failures as additional\s+errors[\s\S]*report to the parent orchestrator, and stop/i,
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
    expect(safeWorkflow).toMatch(
      /validation and deployment worker never makes the fix\s+itself or retries\s+with changed inputs/i,
    );
    expect(safeWorkflow).toMatch(
      /parent orchestrator routes any release failure to the same\s+implementation worker/i,
    );
    expect(safeWorkflow).toMatch(
      /same\s+implementation worker[\s\S]*new exact candidate[\s\S]*new run/i,
    );
    expect(safeWorkflow).toMatch(
      /passed stage[\s\S]*reused only\s+when[\s\S]*matching input and output hashes/i,
    );
    expect(safeWorkflow).toMatch(
      /report to the parent orchestrator, and stop/i,
    );
    expect(safeWorkflow).not.toMatch(/launch another fresh adversarial reviewer/i);
    expect(safeWorkflow).not.toMatch(
      /implementation worker (?:starts|spawns|creates) (?:a|the|one) validation and deployment worker/i,
    );
    expect(validationWorkflow).toMatch(
      /smallest targeted checks[\s\S]*Batch related targets and all planned fixes/i,
    );
    expect(validationWorkflow).toMatch(
      /Do not run\s+the full configured integration pool after each edit, pin update, focused\s+failure, or review exchange/i,
    );
    expect(validationWorkflow).toMatch(
      /full configured integration pool once immediately before sending\s+the candidate to the retained reviewer/i,
    );
    expect(validationWorkflow).toMatch(
      /Persist the candidate head or input\s+hash/i,
    );
    expect(validationWorkflow).toMatch(
      /Reuse that full result only while the recorded candidate inputs are\s+unchanged/i,
    );
    expect(safeWorkflow).toMatch(
      /reviewer requests no candidate-file changes[\s\S]*do not rerun the local\s+full pool/i,
    );
    expect(safeWorkflow).toMatch(
      /batch the complete\s+remediation[\s\S]*full configured integration pool once on\s+the final remediated candidate/i,
    );
    expect(safeWorkflow).toMatch(
      /remote full run does not\s+require another unchanged local full run/i,
    );
    expect(safeWorkflow).not.toMatch(
      /after (?:each|every) (?:fix|finding)[\s\S]{0,120}full configured integration pool/i,
    );
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
      /Before asking, update the plan and the\s+issue status with the blocker/i,
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
