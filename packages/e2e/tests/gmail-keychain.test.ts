import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const tempRoots: string[] = [];

function createFixture(): {
  fakeSecurity: string;
  log: string;
  root: string;
  source: string;
  state: string;
} {
  const root = mkdtempSync(join(tmpdir(), "puddles-gmail-keychain-"));
  tempRoots.push(root);
  const fakeSecurity = join(root, "security");
  const state = join(root, "state");
  const log = join(root, "calls.jsonl");
  writeFileSync(
    fakeSecurity,
    `#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
import time

args = sys.argv[1:]
Path(os.environ["FAKE_SECURITY_LOG"]).open("a").write(json.dumps(args) + "\\n")
state = Path(os.environ["FAKE_SECURITY_STATE"])
command = args[0] if args else ""

if command == "find-generic-password":
    if not state.exists():
        raise SystemExit(44)
    if "-w" in args:
        sys.stdout.buffer.write(state.read_bytes())
    raise SystemExit(0)

if command != "add-generic-password":
    print("unsupported fake security command", file=sys.stderr)
    raise SystemExit(2)

if os.environ.get("FAKE_SECURITY_TIMEOUT") == "1":
    time.sleep(10)

exists = state.exists()
if exists and "-U" not in args:
    raise SystemExit(45)
if "-X" not in args:
    print("missing hexadecimal data", file=sys.stderr)
    raise SystemExit(2)
encoded = args[args.index("-X") + 1]
state.write_bytes(bytes.fromhex(encoded))
`,
  );
  chmodSync(fakeSecurity, 0o755);
  return {
    fakeSecurity,
    log,
    root,
    source: join(repoRoot, "servers", "gmail-mcp", "src"),
    state,
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Gmail Keychain backend", () => {
  it("preserves long values and never reapplies ACLs during refresh", async () => {
    const fixture = createFixture();
    const probe = `
import sys
sys.path.insert(0, ${JSON.stringify(fixture.source)})
import gmail_mcp.keychain as keychain
keychain.SECURITY_COMMAND = ${JSON.stringify(fixture.fakeSecurity)}
first = '{"token":"' + ('a' * 300) + '"}'
second = '{"token":"' + ('b' * 350) + '"}'
keychain.write_token(first)
assert keychain.read_token() == first
keychain.write_token(second)
assert keychain.read_token() == second
`;

    await execFileAsync("python3", ["-c", probe], {
      env: {
        ...process.env,
        FAKE_SECURITY_LOG: fixture.log,
        FAKE_SECURITY_STATE: fixture.state,
      },
    });

    const calls = readFileSync(fixture.log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const writes = calls.filter(([command]) => command === "add-generic-password");
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain("-T");
    expect(writes[0]).not.toContain("-U");
    expect(writes[1]).toContain("-U");
    expect(writes[1]).not.toContain("-T");
  });

  it("bounds write timeouts without rendering sensitive arguments", async () => {
    const fixture = createFixture();
    writeFileSync(fixture.state, "existing");
    const sensitive = '{"token":"' + "secret-marker".repeat(20) + '"}';
    const probe = `
import sys
import traceback
sys.path.insert(0, ${JSON.stringify(fixture.source)})
import gmail_mcp.keychain as keychain
keychain.SECURITY_COMMAND = ${JSON.stringify(fixture.fakeSecurity)}
keychain.KEYCHAIN_ACCESS_TIMEOUT_S = 0.05
try:
    keychain.write_token(${JSON.stringify(sensitive)})
except keychain.KeychainAccessError:
    print(traceback.format_exc())
else:
    raise AssertionError("expected a bounded Keychain timeout")
`;

    const { stdout } = await execFileAsync("python3", ["-c", probe], {
      env: {
        ...process.env,
        FAKE_SECURITY_LOG: fixture.log,
        FAKE_SECURITY_STATE: fixture.state,
        FAKE_SECURITY_TIMEOUT: "1",
      },
    });

    expect(stdout).toContain("macOS Keychain access timed out");
    expect(stdout).not.toContain(sensitive);
    expect(stdout).not.toContain(Buffer.from(sensitive).toString("hex"));
  });
});
