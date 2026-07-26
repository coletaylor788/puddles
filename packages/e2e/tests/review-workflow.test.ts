import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
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
    expect(safeWorkflow).toContain('version: "1.4.0"');
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
      /terminal fresh review against the exact\s+commit/i,
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

    expect(reviewWorkflow).toContain('version: "1.2.0"');
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
});
