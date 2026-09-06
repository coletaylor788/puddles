import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  argvSha256,
  atomicWriteJson,
  candidateTreeSha256,
  sha256File,
  stageCanResume,
} from "../src/release-state.mjs";
import {
  assertPullRequestReady,
  resolveExternalRunDirectory,
} from "../bin/openclaw-release.mjs";

const roots: string[] = [];

function repository() {
  const root = mkdtempSync(join(tmpdir(), "puddles-release-state-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Release Test"]);
  writeFileSync(join(root, "tracked.txt"), "base\n");
  execFileSync("git", ["-C", root, "add", "tracked.txt"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "base"]);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release state", () => {
  it("hashes tracked diff plus sorted untracked paths and bytes", () => {
    const first = repository();
    writeFileSync(join(first, "tracked.txt"), "changed\n");
    mkdirSync(join(first, "nested"));
    writeFileSync(join(first, "z.txt"), "z");
    writeFileSync(join(first, "nested", "a.txt"), "a");
    const initial = candidateTreeSha256(first);

    expect(candidateTreeSha256(first)).toBe(initial);
    writeFileSync(join(first, "nested", "a.txt"), "different");
    expect(candidateTreeSha256(first)).not.toBe(initial);
    writeFileSync(join(first, "nested", "a.txt"), "a");
    writeFileSync(join(first, "extra.txt"), "");
    expect(candidateTreeSha256(first)).not.toBe(initial);
  });

  it("writes atomic JSON and invalidates resume when an output changes", () => {
    const root = repository();
    const output = join(root, "receipt.json");
    atomicWriteJson(output, { status: "passed" });
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ status: "passed" });

    const argv = ["tool", "--flag", "value"];
    const inputs = { head: "a".repeat(40) };
    const state = {
      schemaVersion: 1,
      status: "passed",
      argvSha256: argvSha256(argv),
      inputs,
      outputs: { [output]: sha256File(output) },
    };
    expect(stageCanResume(state, { argv, inputs })).toBe(true);
    writeFileSync(output, "{}\n");
    expect(stageCanResume(state, { argv, inputs })).toBe(false);
  });

  it("rejects a run directory that escapes through a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "puddles-release-path-"));
    roots.push(root);
    const protectedRoot = join(root, "repository");
    const externalRoot = join(root, "runs");
    mkdirSync(protectedRoot);
    mkdirSync(externalRoot);
    symlinkSync(protectedRoot, join(externalRoot, "escaped"));

    expect(() =>
      resolveExternalRunDirectory(join(externalRoot, "escaped", "run"), [
        protectedRoot,
      ]),
    ).toThrow(/outside repository and source trees/);
    expect(() =>
      readFileSync(join(protectedRoot, "run", "run.json"), "utf8"),
    ).toThrow();
  });

  it("requires a completed successful remote check", () => {
    const head = "a".repeat(40);
    const base = "b".repeat(40);
    const state = {
      headRefOid: head,
      baseRefOid: base,
      isDraft: false,
      state: "OPEN",
      mergeable: "MERGEABLE",
      reviewDecision: "APPROVED",
      statusCheckRollup: [],
    };

    expect(() => assertPullRequestReady(state, head, base)).toThrow(
      /checks are not all complete and successful/,
    );
    expect(() =>
      assertPullRequestReady(
        {
          ...state,
          statusCheckRollup: [{ conclusion: "SUCCESS" }],
        },
        head,
        base,
      ),
    ).not.toThrow();
  });
});
