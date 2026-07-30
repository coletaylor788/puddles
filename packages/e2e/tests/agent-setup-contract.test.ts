import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");

function readMainAgentExample(path: string): {
  subagents?: {
    allowAgents?: string[];
    requireAgentId?: boolean;
  };
} {
  const content = readFileSync(join(repoRoot, path), "utf8");
  const match = content.match(
    /openclaw config set 'agents\.list\[0\]' '(\{[\s\S]*?\})' --strict-json/,
  );
  if (!match) {
    throw new Error(`main agent config example not found in ${path}`);
  }
  return JSON.parse(match[1]) as {
    subagents?: {
      allowAgents?: string[];
      requireAgentId?: boolean;
    };
  };
}

describe("coordinator agent setup contract", () => {
  it.each([
    "docs/openclaw-setup/03-openclaw-and-agent-sandboxing.md",
    "docs/openclaw-setup/04-secure-gmail.md",
  ])("%s keeps explicit reader targeting and intentional self-spawn", (path) => {
    const main = readMainAgentExample(path);

    expect(main.subagents?.requireAgentId).toBe(true);
    expect(main.subagents?.allowAgents).toEqual(
      expect.arrayContaining(["main", "reader"]),
    );
  });

  it("updates an existing live policy through leaf keys only", () => {
    const path =
      "docs/openclaw-setup/patches/subagent-cross-agent-spawn-fix.md";
    const content = readFileSync(join(repoRoot, path), "utf8");

    expect(content).toContain(
      "config set 'agents.list[0].subagents.allowAgents'",
    );
    expect(content).toContain(
      "config set 'agents.list[0].subagents.requireAgentId'",
    );
    expect(
      content.indexOf(
        "config set 'agents.list[0].subagents.requireAgentId'",
      ),
    ).toBeLessThan(
      content.indexOf("config set 'agents.list[0].subagents.allowAgents'"),
    );
    expect(content).not.toMatch(
      /config set 'agents\.list\[0\]\.subagents'[\s\\]/,
    );
    expect(content).toContain(
      "agents.list[0].subagents.allowAgents is unset",
    );
    expect(content).toContain("process.exit(1)");
    expect(content).toContain("agents.defaults.subagents.allowAgents");
    expect(content).toContain("set -euo pipefail");
  });
});
