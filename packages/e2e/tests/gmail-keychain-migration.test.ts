import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const gmailSource = join(repoRoot, "servers", "gmail-mcp", "src");
const tempRoots: string[] = [];

describe("Gmail stable Keychain migration", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("copies the token without exposing it and is idempotent", () => {
    const fixture = createFixture();
    const token = JSON.stringify({
      refresh_token: "refresh-secret-marker",
      client_id: "client",
      client_secret: "secret",
    });

    const first = runMigration(fixture, token);
    const second = runMigration(fixture, token);

    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(first.stdout).not.toContain("refresh-secret-marker");
    expect(first.stderr).not.toContain("refresh-secret-marker");
    expect(first.stdout).not.toContain(Buffer.from(token).toString("hex"));
    expect(readFileSync(fixture.state, "utf8")).toBe(token);
    const calls = readCalls(fixture.log);
    const creates = calls.filter(([command]) => command === "add-generic-password");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain("/usr/bin/security");
    expect(creates[0]).toContain("gmail-mcp-stable");
  });

  it("refuses to overwrite a different stable credential", () => {
    const fixture = createFixture();
    writeFileSync(fixture.state, "different");
    const token = JSON.stringify({
      refresh_token: "refresh-secret-marker",
      client_id: "client",
      client_secret: "secret",
    });

    const result = runMigration(fixture, token);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("different data");
    expect(result.stderr).not.toContain("refresh-secret-marker");
    expect(readFileSync(fixture.state, "utf8")).toBe("different");
  });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "gmail-keychain-migration-"));
  tempRoots.push(root);
  const modules = join(root, "modules");
  const security = join(root, "security");
  const state = join(root, "state");
  const log = join(root, "calls.jsonl");
  mkdirSync(modules);
  writeFileSync(
    join(modules, "keyring.py"),
    "import os\n\ndef get_password(service, account):\n    return os.environ.get('LEGACY_TOKEN')\n",
  );
  writeFileSync(
    security,
    `#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
Path(os.environ["FAKE_SECURITY_LOG"]).open("a").write(json.dumps(args) + "\\n")
state = Path(os.environ["FAKE_SECURITY_STATE"])
command = args[0] if args else ""
if command == "find-generic-password":
    if not state.exists():
        raise SystemExit(44)
    sys.stdout.buffer.write(state.read_bytes())
    raise SystemExit(0)
if command == "add-generic-password":
    encoded = args[args.index("-X") + 1]
    state.write_bytes(bytes.fromhex(encoded))
    raise SystemExit(0)
raise SystemExit(2)
`,
  );
  chmodSync(security, 0o755);
  return { root, modules, security, state, log };
}

function runMigration(
  fixture: ReturnType<typeof createFixture>,
  token: string,
) {
  return spawnSync(
    "python3",
    [
      "-m",
      "gmail_mcp.scripts.migrate_legacy_keychain",
      "--security-command",
      fixture.security,
      "--trusted-command",
      "/usr/bin/security",
      "--keychain",
      join(fixture.root, "login.keychain-db"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_SECURITY_LOG: fixture.log,
        FAKE_SECURITY_STATE: fixture.state,
        LEGACY_TOKEN: token,
        PYTHONPATH: `${fixture.modules}:${gmailSource}`,
      },
    },
  );
}

function readCalls(path: string): string[][] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}
