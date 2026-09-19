import { spawnSync } from "node:child_process";
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { dirname } from "node:path";

const gib = 1024 ** 3;

export function resolveResourceProfile(env = process.env, host = {}) {
  const name = env.E2E_RESOURCE_PROFILE ?? "default";
  const measure = env.E2E_RESOURCE_MEASURE === "1";
  if (env.E2E_RESOURCE_MEASURE !== undefined && !["0", "1"].includes(env.E2E_RESOURCE_MEASURE)) {
    throw new Error("E2E_RESOURCE_MEASURE must be 0 or 1");
  }
  const platform = host.platform ?? process.platform;
  const arch = host.arch ?? process.arch;
  const totalMemoryBytes = host.totalMemoryBytes ?? totalmem();
  if (!["default", "hosted-arm"].includes(name)) {
    throw new Error("E2E_RESOURCE_PROFILE must be default or hosted-arm");
  }
  if (name === "hosted-arm" && (platform !== "darwin" || arch !== "arm64")) {
    throw new Error("The hosted-arm resource profile requires macOS arm64");
  }
  const minimumMemoryBytes = name === "hosted-arm" ? 6 * gib : 8 * gib;
  if (totalMemoryBytes < minimumMemoryBytes) {
    throw new Error(
      `Native candidate needs at least ${minimumMemoryBytes} bytes for the ${name} resource profile; host=${totalMemoryBytes}`,
    );
  }
  return {
    name,
    platform,
    arch,
    totalMemoryBytes,
    logicalCpuCount: host.logicalCpuCount ?? availableParallelism(),
    minimumMemoryBytes,
    measure,
    testWorkers: name === "hosted-arm" ? 1 : undefined,
    buildEnvironment: name === "hosted-arm"
      ? { OPENCLAW_NODE_TEST_PLAN_CONCURRENCY: "1" }
      : { NODE_OPTIONS: "--max-old-space-size=8192" },
  };
}

function numberFrom(output, pattern, scale = 1) {
  const match = output.match(pattern);
  return match ? Math.round(Number(match[1]) * scale) : null;
}

export function parseMacMemoryPressure(output) {
  return numberFrom(output, /System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/);
}

export function parseMacSwapUsage(output) {
  const match = output.match(/\bused\s*=\s*(\d+(?:\.\d+)?)([KMG])\b/i);
  if (!match) return null;
  const scale = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[2].toUpperCase()];
  return Math.round(Number(match[1]) * scale);
}

export function parseProcessTreeRss(output, rootPid) {
  const processes = output.trim().split("\n").map((line) => {
    const [pid, parentPid, processGroupId, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, parentPid, processGroupId, rss };
  }).filter(({ pid, parentPid, processGroupId, rss }) =>
    Number.isSafeInteger(pid) && Number.isSafeInteger(parentPid) &&
    Number.isSafeInteger(processGroupId) && Number.isFinite(rss));
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (descendants.has(process.parentPid) && !descendants.has(process.pid)) {
        descendants.add(process.pid);
        changed = true;
      }
    }
  }
  return processes.reduce((total, process) =>
    descendants.has(process.pid) || process.processGroupId === rootPid
      ? total + process.rss * 1024
      : total, 0);
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout : "";
}

export function sampleCommandResources(rootPid, diskPath, platform = process.platform) {
  const rssBytes = parseProcessTreeRss(
    commandOutput("ps", ["-axo", "pid=,ppid=,pgid=,rss="]),
    rootPid,
  );
  const disk = statfsSync(diskPath);
  if (platform !== "darwin") {
    return { rssBytes, freeMemoryPercent: null, swapUsedBytes: null, freeDiskBytes: disk.bavail * disk.bsize };
  }
  return {
    rssBytes,
    freeMemoryPercent: parseMacMemoryPressure(commandOutput("memory_pressure", ["-Q"])),
    swapUsedBytes: parseMacSwapUsage(commandOutput("sysctl", ["-n", "vm.swapusage"])),
    freeDiskBytes: disk.bavail * disk.bsize,
  };
}

export function summarizeResourceSamples(samples) {
  if (!samples.length) throw new Error("Resource measurement produced no samples");
  const present = (key) => samples.map((sample) => sample[key]).filter(Number.isFinite);
  const rss = present("rssBytes");
  const pressure = present("freeMemoryPercent");
  const swap = present("swapUsedBytes");
  const disk = present("freeDiskBytes");
  return {
    sampleCount: samples.length,
    peakProcessTreeRssBytes: rss.length ? Math.max(...rss) : null,
    minimumFreeMemoryPercent: pressure.length ? Math.min(...pressure) : null,
    peakSwapUsedBytes: swap.length ? Math.max(...swap) : null,
    minimumFreeDiskBytes: disk.length ? Math.min(...disk) : null,
    initialFreeDiskBytes: disk[0] ?? null,
    finalFreeDiskBytes: disk.at(-1) ?? null,
  };
}

export function startCommandResourceMonitor({
  path,
  rootPid,
  diskPath,
  profile,
  label,
  intervalMs = 1_000,
  sample = sampleCommandResources,
}) {
  const startedAt = new Date();
  const samples = [];
  const takeSample = () => samples.push(sample(rootPid, diskPath, profile.platform));
  takeSample();
  const timer = setInterval(takeSample, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    takeSample();
    const summary = summarizeResourceSamples(samples);
    if (profile.name === "hosted-arm" &&
        (!Number.isFinite(summary.minimumFreeMemoryPercent) || !Number.isFinite(summary.peakSwapUsedBytes))) {
      throw new Error("Hosted ARM resource measurement requires macOS pressure and swap evidence");
    }
    const finishedAt = new Date();
    const receipt = {
      schema: "puddles.native-command-resources/v2",
      profile: profile.name,
      label,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      host: {
        platform: profile.platform,
        arch: profile.arch,
        totalMemoryBytes: profile.totalMemoryBytes,
        logicalCpuCount: profile.logicalCpuCount,
      },
      concurrency: { mappedTestWorkers: profile.testWorkers ?? null },
      ...summary,
    };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return receipt;
  };
}
