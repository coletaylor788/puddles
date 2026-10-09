import { isDeepStrictEqual } from "node:util";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function exact(value, names) {
  if (!object(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) {
    throw new Error("Invalid session model default operation");
  }
}
export function validateSessionModelDefaults(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 16) throw new Error("Invalid session model default operation count");
  const agents = new Set();
  for (const operation of operations) {
    exact(operation, ["agentId", "expected", "desired"]);
    if (typeof operation.agentId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(operation.agentId) || agents.has(operation.agentId)) throw new Error("Invalid or duplicate session model agent");
    agents.add(operation.agentId);
    for (const selection of [operation.expected, operation.desired]) {
      exact(selection, ["provider", "model"]);
      if (typeof selection.provider !== "string" || typeof selection.model !== "string" ||
          !/^[a-z0-9][a-z0-9-]{0,63}$/.test(selection.provider) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,199}$/.test(selection.model)) throw new Error("Invalid session model selection");
    }
    if (isDeepStrictEqual(operation.expected, operation.desired)) throw new Error("Session model default must change");
    if (operation.expected.provider !== operation.desired.provider) throw new Error("Session model defaults must retain the provider");
  }
  return operations;
}

function selected(entry, expected) {
  return entry.modelOverrideSource === "auto" && entry.providerOverride === expected.provider &&
    entry.modelOverride === expected.model && entry.modelOverrideFallbackOriginProvider === expected.provider &&
    entry.modelOverrideFallbackOriginModel === expected.model;
}
function assertIdle(entry) {
  if (!entry.sessionId || entry.modelSelectionLocked === true ||
      !["done", "failed", "interrupted", "killed", "timeout"].includes(entry.status) ||
      entry.liveModelSwitchPending || entry.cronRunContinuation || entry.pendingFinalDelivery ||
      entry.pendingDeliveryNotice || entry.pendingTranscriptRepair?.length || entry.restartRecoveryRuns?.length) {
    throw new Error("Selected session model default is locked or not idle");
  }
}

// Runs only inside the activation's stopped, snapshotted migration transaction.
// The native accessor owns row CAS and preserves generation-private history and writer fields.
export async function executeSessionModelDefaults({ operations, config, stateDir, sdk, assertCurrent, assertStatePath }) {
  validateSessionModelDefaults(operations);
  const env = { ...process.env, OPENCLAW_STATE_DIR: stateDir };
  const plans = [];
  const check = () => { assertCurrent(); };
  for (const operation of operations) {
    check();
    const configured = config.agents?.entries?.[operation.agentId]?.model;
    const primary = typeof configured === "string" ? configured : configured?.primary;
    if (primary !== `${operation.desired.provider}/${operation.desired.model}`) throw new Error("Session model default differs from configured agent primary");
    const storePath = sdk.resolveStorePath(config.session?.store, { agentId: operation.agentId, env });
    const paths = sdk.resolveSessionStoreBackupPaths({ agentId: operation.agentId, storePath });
    for (const path of paths) assertStatePath(path);
    const scope = { agentId: operation.agentId, storePath, env };
    for (const { sessionKey, entry } of sdk.listSessionEntries({ ...scope, readOnly: true })) {
      if (!selected(entry, operation.expected)) continue;
      if (!sessionKey.startsWith(`agent:${operation.agentId}:`)) throw new Error("Session model default owner differs");
      assertIdle(entry);
      const before = structuredClone(entry), after = structuredClone(entry);
      sdk.applyModelOverrideToSessionEntry({ entry: after, selection: { ...operation.desired, isDefault: true },
        explicitDefaultSelection: true, preserveAuthProfileOverride: true });
      if (Object.hasOwn(before, "updatedAt")) after.updatedAt = before.updatedAt;
      else delete after.updatedAt;
      const patch = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(key => !isDeepStrictEqual(before[key], after[key]))
        .map(key => [key, after[key]]));
      const mutable = new Set(["modelOverrideSource", "providerOverride", "modelOverride", "modelOverrideRouteResolution",
        "modelOverrideFallbackOriginProvider", "modelOverrideFallbackOriginModel", "model", "modelProvider",
        "contextTokens", "contextTokensSource", "contextBudgetStatus", "fallbackNotice"]);
      if (Object.keys(patch).some(key => !mutable.has(key))) throw new Error("Native default selection changed unrelated session metadata");
      plans.push({ scope, sessionKey, before, after, patch, paths });
    }
  }
  // Validate every selected row before the first mutation. Later drift aborts activation,
  // whose existing recovery restores the complete predecessor state snapshot.
  const verify = plan => {
    check();
    for (const path of plan.paths) assertStatePath(path);
    if (!isDeepStrictEqual(sdk.getSessionEntry({ ...plan.scope, sessionKey: plan.sessionKey }), plan.before)) {
      throw new Error("Session model default predecessor changed");
    }
  };
  for (const plan of plans) verify(plan);
  for (const plan of plans) {
    verify(plan);
    const actual = await sdk.patchSessionEntry({ ...plan.scope, sessionKey: plan.sessionKey,
      preserveActivity: true, skipMaintenance: true, requireWriteSuccess: true,
      assertCommitAllowed: () => { check(); for (const path of plan.paths) assertStatePath(path); },
      update(entry, context) {
        if (!context.existingEntry || !isDeepStrictEqual(entry, plan.before)) throw new Error("Session model default predecessor changed");
        assertIdle(entry);
        return plan.patch;
      },
    });
    // The native patch return can retain explicit undefined deletion keys. Check
    // the persisted public projection, which omits them just like the read plan.
    const persisted = sdk.getSessionEntry({ ...plan.scope, sessionKey: plan.sessionKey, readConsistency: "latest" });
    if (!actual || !isDeepStrictEqual(persisted, plan.after)) throw new Error("Session model default result differs");
  }
  check();
  return { changed: plans.length };
}
