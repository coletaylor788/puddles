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
const planContract = readFileSync(
  resolve(repoRoot, "docs/plans/034-plan-and-issue-writing-contract.md"),
  "utf8",
);

const contractDocs = { repoInstructions, safeWorkflow };

const agentSubsections = [
  "### State",
  "### Scope and acceptance criteria",
  "### Architecture and decisions",
  "### Implementation",
  "### Validation",
  "### Rollout and rollback",
  "### Review log",
  "### Checklist",
];

function headings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.trim());
}

describe("writing style contract", () => {
  it("states the human-facing writing rules in both contract documents", () => {
    for (const [name, doc] of Object.entries(contractDocs)) {
      expect(doc, name).toMatch(
        /plans, issues, issue comments, pull\s+request descriptions, and commit messages/i,
      );
      expect(doc, name).toMatch(
        /explaining it to a coworker at their desk/i,
      );
      expect(doc, name).toMatch(/Short sentences\. Everyday words\./i);
      expect(doc, name).toMatch(
        /Never use an em dash\. Use a period, a comma, or parentheses instead\./i,
      );
      expect(doc, name).toMatch(
        /Do not stack nouns into long technical phrases/i,
      );
      expect(doc, name).toMatch(
        /Human facing parts are real paragraphs, not bullet lists/i,
      );
      expect(doc, name).toMatch(
        /leverage, utilize, holistic, robust, comprehensive,\s+seamless/i,
      );
      expect(doc, name).toMatch(
        /Do not narrate the process or list everything you did/i,
      );
      expect(doc, name).toMatch(
        /Do not write like a policy document or a legal contract/i,
      );
    }
  });

  it("keeps em dashes out of the contract documents and the example plan", () => {
    for (const [name, doc] of Object.entries({
      ...contractDocs,
      planContract,
    })) {
      expect(doc, name).not.toContain("\u2014");
    }
  });
});

describe("plan format contract", () => {
  it("requires the Human section and Agent section structure", () => {
    expect(safeWorkflow).toMatch(
      /only `Status`, `Issue`, `Last updated`, and optionally `Owner`/,
    );
    expect(safeWorkflow).toMatch(
      /`## Human section`, with exactly `### Design` and `### Status`/,
    );
    expect(safeWorkflow).toMatch(
      /`## Agent section`, with exactly `### State`,[\s\S]*`### Review log`, and `### Checklist`, in that order/,
    );
    expect(safeWorkflow).toMatch(
      /`### Design` explains the problem and how the solution works/,
    );
    expect(safeWorkflow).toMatch(
      /not contain file paths, function names, class names, command names, commit\s+SHAs, line numbers, or any other code pointer/i,
    );
    expect(safeWorkflow).toMatch(
      /`### Status` says where the work stands[\s\S]*Two short paragraphs at most\. Present\s+tense, no chronology/i,
    );
    expect(safeWorkflow).toMatch(
      /`Agent section` is where code pointers, file paths, commands, commit\s+ids, and evidence belong/i,
    );
    expect(safeWorkflow).toMatch(
      /Do not add another top-level section, an append-only status log, or a\s+second copy of the design narrative/i,
    );
    expect(safeWorkflow).toMatch(
      /re-read and rewrite both sections[\s\S]*stay current and synchronized/i,
    );
    expect(repoInstructions).toMatch(
      /`Human section` and `Agent section` format defined by\s+`safe-feature-development`/,
    );
  });

  it("drops every trace of the retired plan and issue contract", () => {
    for (const [name, doc] of Object.entries(contractDocs)) {
      expect(doc, name).not.toMatch(/Human design/);
      expect(doc, name).not.toMatch(/Agent details/);
      expect(doc, name).not.toMatch(/ledger/i);
    }
  });
});

describe("issue format contract", () => {
  it("requires a plan link plus Summary and Status prose only", () => {
    expect(safeWorkflow).toMatch(
      /The issue body is exactly a plan link, then two prose sections, and nothing\s+else/i,
    );
    expect(safeWorkflow).toContain(
      "[Plan: `docs/plans/<file>.md`](<absolute url>)",
    );
    expect(safeWorkflow).toMatch(
      /## Summary\n\n\s*<Exactly one paragraph, kept current\./,
    );
    expect(safeWorkflow).toMatch(
      /## Status\n\n\s*<One paragraph, two at the absolute most\./,
    );
    expect(safeWorkflow).toMatch(
      /There is no `## Done` section\. Do not add one\./,
    );
    expect(safeWorkflow).toMatch(
      /No bullet lists and no numbered lists anywhere in the issue body\. Prose\s+only\./i,
    );
    expect(safeWorkflow).toMatch(
      /Rewrite both issue sections in full on every update/i,
    );
    expect(safeWorkflow).toMatch(
      /Detail, evidence, commands, commit ids, validation transcripts, and\s+chronology live in the plan, never in the issue/i,
    );
    expect(safeWorkflow).toMatch(
      /Issue comments follow the same rule: short prose status only/i,
    );
    expect(repoInstructions).toMatch(
      /plan\s+link plus two short prose sections, `Summary` and `Status`, and nothing\s+else/i,
    );
  });

  it("keeps the retained review record out of the issue and candidate diff", () => {
    expect(safeWorkflow).toMatch(
      /Record the clean result and reviewed commit outside the candidate diff/i,
    );
    expect(safeWorkflow).toMatch(
      /Write\s+it into the pull request in the next step/i,
    );
    expect(safeWorkflow).toMatch(
      /repository does not use pull requests/i,
    );
    expect(safeWorkflow).toMatch(/Commit ids do not belong in the\s+issue\./i);
    expect(safeWorkflow).toMatch(
      /Record the retained review result\s+and the reviewed commit identifier here/i,
    );
  });
});

describe("plan 034 follows the format it defines", () => {
  it("uses the exact heading names in the exact order", () => {
    expect(headings(planContract)).toEqual([
      "# Plan 034 - Plan and issue writing contract",
      "## Human section",
      "### Design",
      "### Status",
      "## Agent section",
      ...agentSubsections,
    ]);
  });

  it("carries only the allowed metadata keys", () => {
    const metadata = planContract
      .split("\n")
      .filter((line) => /^\*\*[A-Za-z ]+:\*\*/.test(line))
      .map((line) => line.replace(/^\*\*([A-Za-z ]+):\*\*.*$/, "$1"));
    expect(metadata).toEqual(["Status", "Issue", "Last updated"]);
  });

  it("keeps code pointers out of the Design section", () => {
    const design = planContract.slice(
      planContract.indexOf("### Design"),
      planContract.indexOf("### Status"),
    );
    expect(design).not.toMatch(/`/);
    expect(design).not.toMatch(/\.(md|ts|js|mjs|json|sh|yml|yaml)\b/);
    expect(design).not.toMatch(/\b[0-9a-f]{7,40}\b/);
    expect(design).not.toMatch(/\w+\(\)/);
    expect(design).not.toMatch(/\bpackages\/|docs\/|\.github\//);
  });
});
