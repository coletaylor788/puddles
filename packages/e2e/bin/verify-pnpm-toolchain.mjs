#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectPnpmContext,
  requireSharedPnpmStore,
} from "../src/pnpm-toolchain.mjs";

const repositoryDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceDir = resolve(process.argv[2] ?? process.env.OPENCLAW_SRC ?? "");
if (!process.argv[2] && !process.env.OPENCLAW_SRC) {
  throw new Error("Pass the pinned OpenClaw source path or set OPENCLAW_SRC");
}
const repository = await inspectPnpmContext(repositoryDir);
const source = await inspectPnpmContext(sourceDir);
const result = requireSharedPnpmStore(repository, source);
process.stdout.write(`${JSON.stringify(result)}\n`);
