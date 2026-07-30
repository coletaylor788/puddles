#!/usr/bin/env node

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const state = process.env.E2E_MOCK_STATE;
if (!state) {
  console.error("E2E_MOCK_STATE is required");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] !== "task" || args[1] !== "add") {
  console.error(`Unsupported mock Todoist operation: ${args.join(" ")}`);
  process.exit(2);
}

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const title = args[2];
const project = valueAfter("--project");
const labels = valueAfter("--labels")?.split(",").filter(Boolean) ?? [];
const description = valueAfter("--description");

if (!title || !project || !description || !labels.includes("agent")) {
  console.error("Mock Todoist task add requires title, project, description, and agent label");
  process.exit(2);
}

mkdirSync(state, { recursive: true });
const task = {
  id: "mock-todoist-task",
  content: title,
  description,
  project,
  labels,
  url: "https://app.todoist.com/app/task/mock-todoist-task",
  mock: true,
};
appendFileSync(join(state, "todoist-writes.jsonl"), `${JSON.stringify(task)}\n`);
process.stdout.write(`${JSON.stringify(task)}\n`);
