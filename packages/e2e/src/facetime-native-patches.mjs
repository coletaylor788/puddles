import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./process-runner.mjs";

const patchRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/openclaw-setup/patches/facetime-native");
const manifest = JSON.parse(readFileSync(join(patchRoot, "manifest.json"), "utf8"));

// Always create new owned source. Never patch an installed helper or the source cache.
export async function prepareFaceTimeNative(destination, source = manifest.repository) {
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.revision)) {
    throw new Error("Invalid FaceTime native source pin");
  }
  const output = resolve(destination);
  mkdirSync(output); // Existing paths, including symlinks, are refused.
  const run = (command, args, extra = {}) => runCommand(command, args, {
    cwd: output, timeoutMs: 10_000, quiet: true, capture: true, ...extra,
  });
  try {
    await run("git", ["init", "--quiet"]);
    await run("git", ["fetch", "--quiet", "--depth=1", "--", source, manifest.revision], { timeoutMs: 60_000 });
    await run("git", ["checkout", "--quiet", "--detach", manifest.revision]);
    const revision = (await run("git", ["rev-parse", "HEAD"])).trim();
    if (revision !== manifest.revision) throw new Error("FaceTime native source pin mismatch");
    const patches = [];
    for (const name of manifest.patches) {
      if (!/^[a-z0-9-]+\.patch$/.test(name)) throw new Error("Invalid native patch name");
      const path = join(patchRoot, name);
      const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
      await run("git", ["apply", "--check", "--index", path]);
      await run("git", ["apply", "--index", path]);
      patches.push({ name, sha256 });
    }
    const tree = (await run("git", ["write-tree"])).trim();
    const identity = { schemaVersion: 1, repository: manifest.repository, revision, patches, tree };
    writeFileSync(join(output, "puddles-native-source.json"), JSON.stringify(identity, null, 2) + "\n");
    return identity;
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function between(source, first, last) {
  const start = source.indexOf(first);
  const end = source.indexOf(last, start + first.length);
  if (start < 0 || end <= start) throw new Error("Native dispatch fixture markers changed");
  return source.slice(start, end);
}

// Compile the actual patched dispatch branches against synthetic Apple calls.
// No helper injection, account access, audio devices, or voice provider is used.
export async function checkFaceTimeNative(source) {
  if (process.platform !== "darwin") throw new Error("FaceTime native checks require macOS");
  const helper = readFileSync(join(source, "helper/FaceTimeHelper/FaceTimeHelper.m"), "utf8");
  const output = mkdtempSync(join(source, ".puddles-native-check-"));
  try {
    for (const [name, event, next] of [
      ["Answer", "answer-call", "leave-call"],
      ["Inspect", "inspect-call", "safety-mute"],
    ]) {
      const dispatch = between(helper, `if ([event isEqualToString:@"${event}"]) {`,
        `    } else if ([event isEqualToString:@"${next}"])`);
      let fixture = readFileSync(join(source, `helper/tests/${name}CallDispatchTests.m`), "utf8");
      fixture = fixture.replace(`/* OPENCLAW_${name.toUpperCase()}_BODY */`, dispatch.slice(dispatch.indexOf("\n") + 1));
      if (name === "Answer") {
        fixture = fixture.replace("/* OPENCLAW_REQUIRED_CALL_UUID */", between(helper,
          "static NSString *RequiredCallUUIDString(", "static BOOL ApplyOutboundSafetyMute("));
      }
      if (name === "Inspect") {
        const field = helper.slice(helper.indexOf("-(void) emitCallStatus:")).match(/^\s*@"has_ended":.*,$/m)?.[0];
        if (!field) throw new Error("Native call status field fixture marker changed");
        fixture = fixture.replace("/* OPENCLAW_STATUS_ENDED_FIELD */", field);
      }
      const path = join(output, `${name}.m`);
      const binary = join(output, name);
      writeFileSync(path, fixture);
      await runCommand("/usr/bin/clang", ["-fobjc-arc", "-framework", "Foundation", "-framework", "Security", path, "-o", binary],
        { timeoutMs: 20_000, quiet: true, capture: true });
      await runCommand(binary, [], { timeoutMs: 5_000, quiet: true, capture: true });
    }
    return { dispatchChecks: 2, passed: true };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

/** Build only call control; the installed vendor capture identity stays unchanged.
 * The locally built image belongs inside a sealed runtime, never a vendor release.
 */
export async function buildFaceTimeNative(destination, source) {
  const identity = await prepareFaceTimeNative(destination, source);
  await checkFaceTimeNative(destination);
  const dylib = join(resolve(destination), "FaceTimeHelper.dylib");
  await runCommand("bash", ["scripts/compile-helper-macabi.sh", dylib], {
    cwd: destination, timeoutMs: 120_000, quiet: true, capture: true,
    env: { ...process.env, FACETIME_HELPER_CONFIGURATION: "release", CODESIGN_IDENTITY: "-" },
  });
  const buildId = readFileSync(`${dylib}.build-id`, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(buildId) || !readFileSync(dylib).includes(Buffer.from(buildId))) {
    throw new Error("Built FaceTime helper has an invalid embedded build identity");
  }
  await runCommand("/usr/bin/codesign", ["--verify", "--strict", dylib],
    { timeoutMs: 10_000, quiet: true, capture: true });
  const receipt = { ...identity, schemaVersion: 2, kind: "source-built", configuration: "release",
    signing: "ad-hoc", buildId,
    helperSha256: createHash("sha256").update(readFileSync(dylib)).digest("hex") };
  writeFileSync(join(destination, "native-helper.json"), JSON.stringify(receipt, null, 2) + "\n");
  return { dylib, receipt };
}
