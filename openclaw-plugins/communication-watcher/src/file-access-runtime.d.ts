// OpenClaw 2026.9.3 exports this facade without its declaration file.
declare module "openclaw/plugin-sdk/file-access-runtime" {
  export function root(
    rootDir: string,
    defaults?: { symlinks: "reject"; hardlinks: "reject" },
  ): Promise<{
    read(relativePath: string): Promise<{
      buffer: Buffer;
      stat: import("node:fs").Stats;
    }>;
  }>;
}
