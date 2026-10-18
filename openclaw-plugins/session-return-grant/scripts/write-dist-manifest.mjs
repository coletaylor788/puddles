import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
writeFileSync(new URL("dist/package.json", root), `${JSON.stringify({
  name: source.name, version: source.version, description: source.description,
  type: "module", main: "./plugin.js", types: "./plugin.d.ts",
  openclaw: { extensions: ["./plugin.js"] }, peerDependencies: source.peerDependencies,
}, null, 2)}\n`);
copyFileSync(fileURLToPath(new URL("openclaw.plugin.json", root)), fileURLToPath(new URL("dist/openclaw.plugin.json", root)));
