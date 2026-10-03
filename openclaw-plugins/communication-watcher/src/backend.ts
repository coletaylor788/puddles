import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { BoundaryError, object } from "./guards.js";
import type { InboxBackend } from "./inbox.js";

export type Command = (args: string[]) => Promise<Record<string, unknown>>;
/** Host-owned binary and config directory only; no shell, model flags, or inherited CLI profile. */
export function cli(binary: string, configDir: string, profile: string): Command {
  if (!isAbsolute(binary) || !isAbsolute(configDir) || !/^[a-zA-Z0-9_-]+$/.test(profile)) throw new BoundaryError("invalid");
  return args => new Promise((resolve, reject) => {
    execFile(binary, [...args, "--profile", profile, "--format", "json"], {
      timeout: 15_000, maxBuffer: 512 * 1024, encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME, APPLE_PIM_CONFIG_DIR: configDir },
    }, (error, stdout) => {
      if (error) { reject(new BoundaryError("unavailable")); return; }
      try {
        const value = object(JSON.parse(stdout));
        if (value.success !== true) throw new Error();
        resolve(value);
      } catch { reject(new BoundaryError("unavailable")); }
    });
  });
}
export function reminders(command: Command, listId: string): InboxBackend {
  return {
    async list(completed, limit) {
      const value = await command(["items", "--list", listId, "--limit", String(limit), ...(completed ? ["--filter", "completed"] : [])]);
      if (!Array.isArray(value.reminders)) throw new BoundaryError("unavailable");
      return value.reminders;
    },
    async get(id) { return (await command(["get", "--id", id])).reminder; },
    async complete(id) {
      await command(["complete", "--id", id]);
      // Never forward the CLI's full reminder response from a write tool.
      return undefined;
    },
  };
}
