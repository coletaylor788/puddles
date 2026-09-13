import { executeStateMigration } from "../src/native-state-migration.mjs";

const [phase, runtime, stateDir, manifestPath, sha256, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Unexpected state migration arguments");
await executeStateMigration({ phase, runtime, stateDir, manifestPath, sha256 });
