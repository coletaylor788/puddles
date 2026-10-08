import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("checks live and queued backup consumers through the host checker", () => {
  execFileSync("python3", [fileURLToPath(new URL("./backup-consumers.test.py", import.meta.url))], {
    stdio: "pipe", timeout: 30_000,
  });
});
