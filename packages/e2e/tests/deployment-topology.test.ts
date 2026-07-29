import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const deployScript = join(
  repoRoot,
  "docs",
  "openclaw-setup",
  "patches",
  "apply-and-deploy.sh",
);
const tempRoots: string[] = [];

function runDeployment(
  miniHost?: string,
  failRootPack = false,
  failPostInstall = false,
): string[] {
  const root = mkdtempSync(join(tmpdir(), "puddles-deploy-test-"));
  tempRoots.push(root);
  const source = join(root, "openclaw");
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  mkdirSync(source);
  mkdirSync(bin);
  mkdirSync(join(source, "packages", "ai"), { recursive: true });
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({
      name: "openclaw",
      dependencies: { "@openclaw/ai": "workspace:*" },
    }),
  );
  writeFileSync(
    join(source, "packages", "ai", "package.json"),
    JSON.stringify({ name: "@openclaw/ai", version: "1.0.0" }),
  );
  writeFileSync(join(source, "pnpm-lock.yaml"), "original-lock\n");

  const mock = `#!/bin/sh
name="$(basename "$0")"
printf '%s' "$name" >> "$COMMAND_LOG"
for arg in "$@"; do printf '\\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
if [ "$name" = launchctl ] && [ "\${FAIL_POST_INSTALL:-0}" = 1 ]; then
  exit 46
fi
if [ "$name" = ssh ]; then
  case "$*" in
    *'printf "%s"'*) printf '%s' /remote/home/.openclaw/deploy-artifacts; exit 0 ;;
  esac
fi
if [ "$name" = npm ] && [ "\${1:-}" = pack ]; then
  destination=.
  previous=
  for arg in "$@"; do
    if [ "$previous" = --pack-destination ]; then destination="$arg"; fi
    previous="$arg"
  done
  case "$PWD" in
    */packages/ai) output=openclaw-ai-test.tgz ;;
    *)
      [ "\${PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN:-}" = false ] || exit 43
      grep -q '"@openclaw/ai": "file:' package.json || exit 42
      ref="$(sed -n 's/.*"@openclaw\\/ai": "\\(file:[^"]*\\)".*/\\1/p' package.json)"
      [ -n "$ref" ] || exit 44
      printf 'airef\\t%s\\n' "$ref" >> "$COMMAND_LOG"
      printf 'mutated-lock\\n' > pnpm-lock.yaml
      [ "\${FAIL_ROOT_PACK:-0}" != 1 ] || exit 45
      output=openclaw-test.tgz
      ;;
  esac
  mkdir -p "$destination"
  : > "$destination/$output"
  printf '%s\\n' "$output"
fi
`;
  for (const command of ["git", "pnpm", "npm", "openclaw", "launchctl", "scp", "ssh"]) {
    const path = join(bin, command);
    writeFileSync(path, mock);
    chmodSync(path, 0o755);
  }
  const nodePath = join(bin, "node");
  writeFileSync(nodePath, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
  chmodSync(nodePath, 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMMAND_LOG: log,
    OPENCLAW_SRC: source,
    OPENCLAW_DEPLOY_ARTIFACT_DIR: join(root, "artifacts"),
    MINI_SANDBOX_BUILD: join(root, "sandbox"),
    PATH: `${bin}:/usr/bin:/bin`,
  };
  if (miniHost) {
    env.MINI_HOST = miniHost;
  } else {
    delete env.MINI_HOST;
  }
  if (failRootPack) {
    env.FAIL_ROOT_PACK = "1";
  }
  if (failPostInstall) {
    env.FAIL_POST_INSTALL = "1";
  }

  const result = spawnSync("/bin/bash", [deployScript], {
    env,
    encoding: "utf8",
  });
  if (failRootPack || failPostInstall) {
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  } else {
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }
  expect(
    JSON.parse(readFileSync(join(source, "package.json"), "utf8")).dependencies[
      "@openclaw/ai"
    ],
  ).toBe("workspace:*");
  expect(readFileSync(join(source, "pnpm-lock.yaml"), "utf8")).toBe(
    "original-lock\n",
  );
  const artifactRoot = join(root, "artifacts");
  const artifactBuilds = existsSync(artifactRoot)
    ? readdirSync(artifactRoot).filter((name) => name.startsWith("build."))
    : [];
  if (!miniHost && (!failRootPack || failPostInstall)) {
    expect(artifactBuilds).toHaveLength(1);
    expect(
      readdirSync(join(artifactRoot, artifactBuilds[0])).sort(),
    ).toEqual(["openclaw-ai-test.tgz", "openclaw-test.tgz"]);
  } else {
    expect(artifactBuilds).toHaveLength(0);
  }
  return readFileSync(log, "utf8").trim().split("\n");
}

function commands(lines: string[]): string[] {
  return lines.map((line) => line.split("\t", 1)[0]);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("OpenClaw deployment topology", () => {
  it("deploys locally by default without SSH or SCP", () => {
    const lines = runDeployment();
    const invoked = commands(lines);

    expect(invoked).toContain("openclaw");
    expect(invoked).toContain("launchctl");
    expect(invoked).not.toContain("ssh");
    expect(invoked).not.toContain("scp");
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^npm\tinstall\t-g\t\/.*\/artifacts\/build\.[^/]+\/openclaw-test\.tgz$/,
      ),
    );
    const packLines = lines.filter((line) => line.startsWith("npm\tpack\t"));
    expect(packLines).toHaveLength(2);
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^airef\tfile:\/.*\/artifacts\/build\.[^/]+\/openclaw-ai-test\.tgz$/,
      ),
    );
    expect(lines).not.toContain("airef\tfile:/tmp/openclaw-ai-test.tgz");
  });

  it("uses SSH and SCP only when a remote target is explicit", () => {
    const lines = runDeployment("approved-mini");
    const invoked = commands(lines);

    expect(invoked).toContain("ssh");
    expect(invoked).toContain("scp");
    expect(invoked).not.toContain("openclaw");
    expect(invoked).not.toContain("launchctl");
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^scp\t\/.*\/openclaw-ai-test\.tgz\t\/.*\/openclaw-test\.tgz\tapproved-mini:\/remote\/home\/\.openclaw\/deploy-artifacts\/$/,
      ),
    );
    expect(lines).toContain(
      "airef\tfile:/remote/home/.openclaw/deploy-artifacts/openclaw-ai-test.tgz",
    );
    expect(lines).toContain(
      "    npm install -g '/remote/home/.openclaw/deploy-artifacts/openclaw-test.tgz'",
    );
  });

  it("restores packaging inputs when root packing fails", () => {
    const lines = runDeployment(undefined, true);

    expect(lines).not.toContainEqual(
      expect.stringMatching(/^npm\tinstall\t-g\t/),
    );
  });

  it("retains recovery artifacts when post-install restart fails", () => {
    const lines = runDeployment(undefined, false, true);

    expect(lines).toContainEqual(
      expect.stringMatching(
        /^npm\tinstall\t-g\t\/.*\/artifacts\/build\.[^/]+\/openclaw-test\.tgz$/,
      ),
    );
  });
});
