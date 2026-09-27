#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  initializeStorage, registerScratch, storageHold, sealScratch,
  planStorageCleanup, applyStorageCleanup, reserveStorage, releaseStorage,
} from "../src/native-storage.mjs";

import { finalizeNativeBuild, finalizeFailedNativeBuild } from "../src/native-storage-finalize.mjs";

const [command, root, owner, argument, extra, overflow] = process.argv.slice(2);
try {
  if (!root || overflow || extra && command !== "finalize-build") throw new Error("Invalid storage arguments");
  let result;
  if (command === "finalize-build" && owner && argument && extra) result = await finalizeNativeBuild(root, owner, argument, extra);
  else if (command === "failed-build" && owner && argument && !extra) result = finalizeFailedNativeBuild(root, owner, argument);
  else if (command === "init" && owner && !argument) result = initializeStorage(root, owner);
  else if (command === "register" && owner && argument) result = registerScratch(root, owner, JSON.parse(readFileSync(argument, "utf8")));
  else if (command === "hold" && owner && argument) result = storageHold(root, owner, argument, true);
  else if (command === "release" && owner && argument) result = storageHold(root, owner, argument, false);
  else if (command === "seal" && owner && argument) result = sealScratch(root, owner, argument);
  else if (command === "plan" && !owner) result = planStorageCleanup(root);
  else if (command === "apply" && owner && !argument) result = applyStorageCleanup(root, owner);
  else if (command === "reserve" && owner && argument) result = reserveStorage(root, owner, Number(argument));
  else if (command === "unreserve" && owner && !argument) result = releaseStorage(root, owner);
  else throw new Error("Usage: openclaw-storage.mjs finalize-build ROOT OWNER BUNDLE SHA256 (after consumer acknowledgement) | failed-build ROOT OWNER BUILD_ROOT | init ROOT OWNER | register ROOT OWNER SPEC | hold|release ROOT OWNER CONSUMER | seal ROOT OWNER ID | plan ROOT | apply ROOT OWNER | reserve HOST_ROOT OWNER BYTES | unreserve HOST_ROOT TOKEN");
  console.log(JSON.stringify(result ?? { status: "released" }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
