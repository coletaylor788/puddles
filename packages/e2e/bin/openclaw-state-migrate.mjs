import { executeStateMigration } from "../src/native-state-migration.mjs";

const [phase, runtime, stateDir, manifestPath, sha256, expectedBuiltInJson, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Unexpected state migration arguments");
const result = await executeStateMigration({
  phase, runtime, stateDir, manifestPath, sha256,
  expectedBuiltIn: expectedBuiltInJson ? JSON.parse(expectedBuiltInJson) : undefined,
});
if (result !== undefined) process.stdout.write(JSON.stringify(result));
