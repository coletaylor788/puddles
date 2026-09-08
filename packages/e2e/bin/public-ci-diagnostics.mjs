#!/usr/bin/env node
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { atomicJson, inside } from "../src/native-state.mjs";
import scenarios from "../scenarios/imessage.mjs";

const maxLogBytes = 64 * 1024;
const stageNames = new Set(["prepare", "dependencies", "build", "regressions", "extension-package", "package", "install", "runtime"]);

function locations(env) {
  if (env.GITHUB_ACTIONS !== "true" || env.E2E_LOCAL_EXTENSION ||
      !/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? "") || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
      !isAbsolute(env.RUNNER_TEMP ?? "") || !isAbsolute(env.E2E_RUN_DIR ?? "")) {
    throw new Error("Diagnostics require a public hosted run with local extensions disabled");
  }
  const temporary = realpathSync(env.RUNNER_TEMP);
  const suffix = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const root = join(temporary, `puddles-public-${suffix}`);
  if (join(realpathSync(dirname(env.E2E_RUN_DIR)), basename(env.E2E_RUN_DIR)) !== root) {
    throw new Error("Diagnostics run directory does not match this hosted attempt");
  }
  return { root, output: join(temporary, `puddles-public-diagnostics-${suffix}`) };
}

function regular(path, directory = false) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error("Refusing linked or unexpected diagnostic input");
  return stat;
}

function json(path) {
  const stat = regular(path);
  if (!stat || stat.size > 1024 * 1024) throw new Error("Missing or oversized public stage record");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("Invalid public stage record"); }
}

function redactor(env) {
  const values = Object.entries(env).filter(([key, value]) => typeof value === "string" && value &&
    (value.length >= 8 || /token|secret|password|passwd|credential|cookie|auth|api.?key/i.test(key)))
    .flatMap(([key, value]) => [
      value, JSON.stringify(value).slice(1, -1),
      ...(/token|secret|password|passwd|credential|cookie|auth|api.?key/i.test(key)
        ? [Buffer.from(value).toString("hex"), Buffer.from(value).toString("base64"), encodeURIComponent(value)] : []),
    ]).sort((a, b) => b.length - a.length);
  return (input) => {
    let text = stripVTControlCharacters(input).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
    for (const value of values) text = text.split(value).join("[redacted]");
    return text
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]");
  };
}

function tail(path) {
  const stat = regular(path);
  if (!stat) return "";
  const length = Math.min(stat.size, maxLogBytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  let bytes;
  try { bytes = readSync(fd, buffer, 0, length, stat.size - length); }
  finally { closeSync(fd); }
  const text = buffer.subarray(0, bytes).toString("utf8");
  if (stat.size <= maxLogBytes) return text;
  const newline = text.indexOf("\n");
  return "[Earlier output omitted]\n" + (newline < 0 ? "[Oversized diagnostic line omitted]\n" : text.slice(newline + 1));
}

export function initializePublicRun(env = process.env) {
  const { root } = locations(env);
  if (existsSync(root) || lstatSync(root, { throwIfNoEntry: false })) throw new Error("Public run directory must be new");
  mkdirSync(root, { mode: 0o700 });
  atomicJson(join(root, "public-ci.json"), { scope: "public-ci", run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT });
  return root;
}

export function collectPublicDiagnostics(env = process.env) {
  const { root, output } = locations(env);
  if (!regular(root, true)) throw new Error("Public run was not initialized");
  const marker = json(join(root, "public-ci.json"));
  if (marker.scope !== "public-ci" || marker.run !== env.GITHUB_RUN_ID || marker.attempt !== env.GITHUB_RUN_ATTEMPT) throw new Error("Public run marker does not match this attempt");
  if (env.GITHUB_STEP_SUMMARY) {
    if (!isAbsolute(env.GITHUB_STEP_SUMMARY) ||
        !inside(realpathSync(env.RUNNER_TEMP), realpathSync(dirname(env.GITHUB_STEP_SUMMARY)))) throw new Error("Job summary must stay inside runner temporary storage");
    regular(env.GITHUB_STEP_SUMMARY);
  }
  const redact = redactor(env);
  const stages = [];
  if (regular(join(root, "stages"), true)) {
    for (const name of stageNames) {
      const path = join(root, "stages", `${name}.json`);
      if (!regular(path)) continue;
      const record = json(path);
      if (record.name !== name || !["passed", "failed", "running"].includes(record.status)) throw new Error("Invalid public stage identity");
      stages.push({ name, status: record.status, key: /^[a-f0-9]{64}$/.test(record.key) ? redact(record.key) : null });
    }
  }
  const logs = [];
  if (regular(join(root, "logs"), true)) {
    for (const name of readdirSync(join(root, "logs")).filter((name) => /^[0-9]+\.log$/.test(name)).sort((a, b) => Number.parseInt(a) - Number.parseInt(b)).slice(-128)) {
      logs.push({ source: join(root, "logs", name), name: `command-${name}` });
    }
  }
  for (const name of readdirSync(root).sort()) {
    if (!scenarios.some(({ id }) => name.startsWith(`fixture-${id}-`) && /^[a-zA-Z0-9]+$/.test(name.slice(`fixture-${id}-`.length)))) continue;
    if (!regular(join(root, name), true)) continue;
    for (const file of ["gateway.log", "openclaw.log", "failure.log"]) {
      if (regular(join(root, name, file))) logs.push({ source: join(root, name, file), name: `${name}-${file}` });
    }
  }
  // Only sanitized, bounded projections are exported. Never upload the run tree.
  mkdirSync(output, { mode: 0o700 });
  let excerpt = "";
  for (const log of logs.slice(-160)) {
    let text = redact(tail(log.source));
    if (Buffer.byteLength(text) > maxLogBytes) {
      const remaining = Buffer.from(text).subarray(-maxLogBytes + 64).toString("utf8");
      const newline = remaining.indexOf("\n");
      text = "[Earlier sanitized output omitted]\n" + (newline < 0 ? "[Oversized line omitted]\n" : remaining.slice(newline + 1));
    }
    writeFileSync(join(output, log.name), text, { mode: 0o600 });
    if (text.trim()) excerpt = text.trim().split("\n").slice(-30).join("\n").slice(-4000);
  }
  atomicJson(join(output, "stages.json"), stages);
  const failed = stages.filter((record) => record.status !== "passed").map((record) => record.name);
  const header = failed.length ? `Public cumulative gate stopped during ${failed.join(", ")}.` : "Public cumulative gate failed before a failure stage was recorded.";
  const summary = `${header}\n\nThe artifact contains bounded, sanitized public logs and stage status only.\n\n${excerpt ? excerpt.split("\n").map((line) => `    ${line}`).join("\n") : "No child output was retained. See the job output for the preflight failure."}\n`;
  writeFileSync(join(output, "summary.md"), summary, { mode: 0o600 });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return { output, summary, logCount: logs.slice(-160).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "init") initializePublicRun();
    else if (process.argv[2] === "collect") {
      const result = collectPublicDiagnostics();
      console.log(result.summary.split("\n").map((line) => `| ${line}`).join("\n"));
    } else throw new Error("Usage: public-ci-diagnostics.mjs <init|collect>");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
