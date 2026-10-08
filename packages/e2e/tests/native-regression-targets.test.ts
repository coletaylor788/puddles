import { expect, it } from "vitest";
// @ts-expect-error executable runner module
import { nativeRegressionTargets } from "../src/native-pipeline.mjs";

it("runs standalone native API regressions together with every mapped patch regression", () => {
  expect(nativeRegressionTargets({ patches: [
    { tests: ["old.test.ts"], candidateTests: ["old-candidate.test.ts"] },
    { tests: ["old.test.ts", "other.test.ts"] },
  ], tests: ["native.test.ts"], candidateTests: ["gmail.test.ts"] })).toEqual({
    tests: ["old.test.ts", "other.test.ts", "native.test.ts"],
    candidateTests: ["old-candidate.test.ts", "gmail.test.ts"],
  });
  expect(nativeRegressionTargets({ patches: [{ tests: ["old.test.ts"] }] })).toEqual({ tests: ["old.test.ts"], candidateTests: [] });
});
