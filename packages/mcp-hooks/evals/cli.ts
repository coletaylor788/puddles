#!/usr/bin/env tsx
/**
 * Eval CLI. Examples:
 *   pnpm eval --llm-provider=my-llm-adapter                    # run all 5 with one provider
 *   pnpm eval --eval=secrets --llm-provider=./adapters/x.js    # run one with a local adapter
 *   pnpm eval --eval=injection --llm-provider=my-llm-adapter -v
 *   pnpm eval --eval=all --llm-provider=my-llm-adapter --output-dir=evals/baselines
 *
 * `--llm-provider` is a Node module specifier whose default export implements
 * mcp-hooks' `LLMClient` interface. The CLI exits without running if it is
 * not provided.
 */
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadLLMProvider } from "../src/load-llm-provider.js";
import { runEval, defaultDatasetPath, datasetExists } from "./runner.js";
import type { EvalName, EvalReport } from "./types.js";

interface ParsedArgs {
  evalName: EvalName | "all";
  verbose: boolean;
  concurrency: number;
  retries: number;
  timeoutMs: number;
  outputDir: string | null;
  llmProvider: string | null;
  model: string | null;
  datasetDir: string | null;
}

const ALL_EVALS: EvalName[] = ["secrets", "sensitive", "pii", "injection", "redact"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.llmProvider) {
    console.error(
      "[eval] --llm-provider=<module-specifier> is required (see packages/mcp-hooks/README.md).",
    );
    process.exit(1);
  }

  const providerOptions: Record<string, unknown> = {};
  if (args.model) providerOptions.model = args.model;
  const llm = await loadLLMProvider(args.llmProvider, providerOptions);
  const evalsToRun: EvalName[] = args.evalName === "all" ? ALL_EVALS : [args.evalName];
  const reports: EvalReport[] = [];

  for (const evalName of evalsToRun) {
    const datasetPath = args.datasetDir
      ? resolve(args.datasetDir, `${evalName}.json`)
      : defaultDatasetPath(evalName);
    if (!datasetExists(datasetPath)) {
      console.warn(`[eval:${evalName}] dataset missing at ${datasetPath} — skipping`);
      continue;
    }

    const outputPath = args.outputDir
      ? resolve(args.outputDir, `${evalName}.json`)
      : undefined;
    if (outputPath) {
      await mkdir(resolve(outputPath, ".."), { recursive: true });
    }

    const modelLabel = args.model ?? "<provider-default>";
    console.log(`\n=== ${evalName} (provider=${args.llmProvider}, model=${modelLabel}) ===`);
    const report = await runEval({
      evalName,
      llm,
      model: args.model ?? "<provider-default>",
      datasetPath,
      outputPath,
      concurrency: args.concurrency,
      retries: args.retries,
      timeoutMs: args.timeoutMs,
      verbose: args.verbose,
    });
    reports.push(report);
    printSummary(report);
    if (outputPath) console.log(`  → wrote ${outputPath}`);
  }

  // Exit non-zero if any eval had API errors AND zero successful cases
  // (i.e. everything failed — likely an auth/network problem worth surfacing).
  const totalFailures = reports.reduce(
    (acc, r) => acc + (r.metricsValidOnly.n === 0 && r.datasetSize > 0 ? 1 : 0),
    0,
  );
  if (totalFailures > 0) {
    console.error(`\n[eval] ${totalFailures} eval(s) had no successful responses`);
    process.exit(2);
  }
  // The LLM client / its transport can leave handles open that keep the
  // event loop alive. Force exit on success.
  process.exit(0);
}

function printSummary(r: EvalReport): void {
  const p = r.metricsProduction;
  const v = r.metricsValidOnly;
  const fmt = (n: number | null) => (n == null ? "n/a" : (n * 100).toFixed(1) + "%");
  console.log(
    `  production : n=${p.n} P=${fmt(p.precision)} R=${fmt(p.recall)} F1=${fmt(p.f1)} FPR=${fmt(p.fpr)}`,
  );
  console.log(
    `  valid-only : n=${v.n} P=${fmt(v.precision)} R=${fmt(v.recall)} F1=${fmt(v.f1)} FPR=${fmt(v.fpr)}`,
  );
  console.log(
    `  errors     : api=${r.errorCounts.api_error} parse=${r.errorCounts.parse_error}`,
  );
  if (r.byDifficulty.length) {
    const parts = r.byDifficulty.map(
      (b) => `${b.key}=F1:${fmt(b.f1)}(n=${b.n})`,
    );
    console.log(`  difficulty : ${parts.join(" ")}`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    evalName: "all",
    verbose: false,
    concurrency: 4,
    retries: 2,
    timeoutMs: 30_000,
    outputDir: null,
    llmProvider: null,
    model: null,
    datasetDir: null,
  };
  for (const arg of argv) {
    if (arg === "-v" || arg === "--verbose") out.verbose = true;
    else if (arg.startsWith("--eval=")) out.evalName = arg.slice(7) as EvalName | "all";
    else if (arg.startsWith("--concurrency=")) out.concurrency = Number(arg.slice(14));
    else if (arg.startsWith("--retries=")) out.retries = Number(arg.slice(10));
    else if (arg.startsWith("--timeout-ms=")) out.timeoutMs = Number(arg.slice(13));
    else if (arg.startsWith("--output-dir=")) out.outputDir = arg.slice(13);
    else if (arg.startsWith("--llm-provider=")) out.llmProvider = arg.slice(15);
    else if (arg.startsWith("--model=")) out.model = arg.slice(8);
    else if (arg.startsWith("--dataset-dir=")) out.datasetDir = arg.slice(14);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage: tsx evals/cli.ts --llm-provider=<module> [options]

Options:
  --llm-provider=<spec> Node module specifier whose default export implements
                        mcp-hooks' LLMClient interface (REQUIRED)
  --eval=<name>         secrets|sensitive|pii|injection|redact|all (default: all)
  --concurrency=<n>     concurrent LLM calls (default: 4)
  --retries=<n>         retries per case on transient failure (default: 2)
  --timeout-ms=<n>      per-call timeout (default: 30000)
  --model=<id>          model id forwarded to the provider's constructor
  --output-dir=<path>   write report JSON files into this directory
  --dataset-dir=<path>  override datasets/ path (used by tests)
  -v, --verbose         log each case as it runs
  -h, --help            this help text
`);
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
