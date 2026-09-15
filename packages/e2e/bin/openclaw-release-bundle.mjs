#!/usr/bin/env node
import { resolve } from "node:path";
import { exportReleaseBundle, importReleaseBundle } from "../src/native-release.mjs";

try {
  const [command, first, second, third, ...extra] = process.argv.slice(2);
  if (extra.length || !first || !second) {
    throw new Error("Usage: openclaw-release-bundle.mjs <export BUILD_JSON BUNDLE_TAR [public|local] | import BUNDLE_TAR IMPORT_DIR>");
  }
  if (command === "export") {
    const result = await exportReleaseBundle(resolve(first), resolve(second), third ?? "public");
    console.log(JSON.stringify(result));
  } else if (command === "import" && !third) {
    const result = await importReleaseBundle(resolve(first), resolve(second));
    console.log(result.receiptPath);
  } else {
    throw new Error("Usage: openclaw-release-bundle.mjs <export BUILD_JSON BUNDLE_TAR [public|local] | import BUNDLE_TAR IMPORT_DIR>");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
