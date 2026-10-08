import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("rehearses actual Doctor ownership migration and external skill rollback", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "candidate-workshop-")));
  roots.push(root);
  for (const name of ["home", "scratch"]) mkdirSync(join(root, name));
  const result = await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, "../fixtures/workshop-doctor.mjs"), "rehearse", candidate!, root], {
    encoding: "utf8", timeout: 100_000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), TMPDIR: join(root, "scratch"),
      DEVELOPER_DIR: process.env.DEVELOPER_DIR,
      OPENCLAW_STATE_DIR: join(root, "state"), OPENCLAW_CONFIG_PATH: join(root, "state/openclaw.json"),
      OPENCLAW_SERVICE_REPAIR_POLICY: "external", NO_COLOR: "1" },
  });
  expect(JSON.parse(result.stdout)).toEqual({ passed: true, actualDoctorFailureReproduced: true, repairedOwnership: true, externalRollback: true });
}, 110_000);
