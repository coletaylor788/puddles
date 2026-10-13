import { isDeepStrictEqual } from "node:util";
import { canonicalValueDigest } from "./native-state.mjs";

// Match the persisted public JSON projection, independent of object key order.
export const sessionModelDefaultEntryDigest = entry => canonicalValueDigest(JSON.parse(JSON.stringify(entry)));

// Only selected-session state enters this witness. Shared conversation labels
// and activity belong to other sessions too, and the native writer preserves them.
export function sessionModelDefaultActivityDigest(db, sessionKey) {
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec("BEGIN");
  try {
    const query = (sql, ...values) => db.prepare(sql).all(...values)
      .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, ArrayBuffer.isView(value) ? { bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex") } : value])));
    const rows = (table, column, value) => query(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY rowid`, value);
    const node = rows("session_nodes", "session_key", sessionKey);
    if (node.length !== 1) throw new Error("Session model recovery activity owner missing");
    const windows = rows("session_windows", "session_key", sessionKey);
    if (!windows.some(row => row.session_id === node[0].current_session_id)) throw new Error("Session model recovery activity window missing");
    const projection = { session_nodes: node, session_windows: windows,
      session_participants: rows("session_participants", "session_key", sessionKey) };
    for (const table of ["transcript_events", "session_transcript_active_events", "transcript_rewrite_watermarks",
      "session_transcript_cold_archives", "session_conversations"]) {
      projection[table] = windows.flatMap(window => rows(table, "session_id", window.session_id));
    }
    for (const table of ["session_transcript_archives", "session_pending_inputs", "session_input_completions"]) {
      projection[table] = query(`SELECT * FROM ${table} WHERE session_key = ? OR session_id IN
        (SELECT session_id FROM session_windows WHERE session_key = ?) ORDER BY rowid`, sessionKey, sessionKey);
    }
    return canonicalValueDigest(projection);
  } finally { if (ownTransaction) db.exec("ROLLBACK"); }
}

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
    exact(operation, ["agentId", "expected", "desired", ...(Object.hasOwn(operation, "recoveries") ? ["recoveries"] : []),
      ...(Object.hasOwn(operation, "additionalExpected") ? ["additionalExpected"] : [])]);
    if (typeof operation.agentId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(operation.agentId) || agents.has(operation.agentId)) throw new Error("Invalid or duplicate session model agent");
    agents.add(operation.agentId);
    if (Object.hasOwn(operation, "recoveries")) {
      if (!Array.isArray(operation.recoveries) || !operation.recoveries.length || operation.recoveries.length > 256) throw new Error("Invalid session model recovery count");
      const keys = new Set();
      for (const recovery of operation.recoveries) {
        exact(recovery, ["sessionKey", "expectedEntrySha256", "expectedActivitySha256", "originalUpdatedAt", "originalWindowActivity"]);
        if (typeof recovery.sessionKey !== "string" || recovery.sessionKey.length > 512 ||
            !recovery.sessionKey.startsWith(`agent:${operation.agentId}:`) || recovery.sessionKey.length <= `agent:${operation.agentId}:`.length ||
            /[\x00-\x20\x7f]/.test(recovery.sessionKey) ||
            keys.has(recovery.sessionKey) || typeof recovery.expectedEntrySha256 !== "string" || !/^[a-f0-9]{64}$/.test(recovery.expectedEntrySha256) ||
            typeof recovery.expectedActivitySha256 !== "string" || !/^[a-f0-9]{64}$/.test(recovery.expectedActivitySha256) ||
            !Number.isSafeInteger(recovery.originalUpdatedAt) || recovery.originalUpdatedAt < 0) throw new Error("Invalid or duplicate session model recovery");
        exact(recovery.originalWindowActivity, ["updatedAt", "transcriptObservedAt"]);
        const window = recovery.originalWindowActivity;
        if (!Number.isSafeInteger(window.updatedAt) || window.updatedAt < 0 ||
            (window.transcriptObservedAt !== null && (!Number.isSafeInteger(window.transcriptObservedAt) || window.transcriptObservedAt < 0))) {
          throw new Error("Invalid session model recovery window activity");
        }
        keys.add(recovery.sessionKey);
      }
    }
    if (Object.hasOwn(operation, "additionalExpected") &&
        (!Array.isArray(operation.additionalExpected) || !operation.additionalExpected.length || operation.additionalExpected.length > 7)) {
      throw new Error("Invalid additional session model selection count");
    }
    const expected = [operation.expected, ...(operation.additionalExpected ?? [])];
    for (const selection of [...expected, operation.desired]) {
      exact(selection, ["provider", "model"]);
      if (typeof selection.provider !== "string" || typeof selection.model !== "string" ||
          !/^[a-z0-9][a-z0-9-]{0,63}$/.test(selection.provider) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,199}$/.test(selection.model)) throw new Error("Invalid session model selection");
    }
    const identities = new Set();
    for (const selection of expected) {
      if (isDeepStrictEqual(selection, operation.desired)) throw new Error("Session model default must change");
      if (selection.provider !== operation.desired.provider) throw new Error("Session model defaults must retain the provider");
      if (identities.has(selection.model)) throw new Error("Duplicate expected session model selection");
      identities.add(selection.model);
    }
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
    const recoveries = new Map((operation.recoveries ?? []).map(recovery => [recovery.sessionKey, recovery]));
    const found = new Set();
    for (const { sessionKey, entry } of sdk.listSessionEntries({ ...scope, readOnly: true })) {
      const recovery = recoveries.get(sessionKey);
      if (!recovery && ![operation.expected, ...(operation.additionalExpected ?? [])].some(expected => selected(entry, expected))) continue;
      if (recovery) {
        if (found.has(sessionKey)) throw new Error("Duplicate session model recovery row");
        found.add(sessionKey);
        if (sessionModelDefaultEntryDigest(entry) !== recovery.expectedEntrySha256 ||
            !Number.isSafeInteger(entry.updatedAt) || recovery.originalUpdatedAt > entry.updatedAt ||
            ["modelOverrideSource", "providerOverride", "modelOverride", "modelOverrideRouteResolution",
             "modelOverrideFallbackOriginProvider", "modelOverrideFallbackOriginModel"].some(key => entry[key] !== undefined)) {
          throw new Error("Session model recovery predecessor differs");
        }
      }
      if (!sessionKey.startsWith(`agent:${operation.agentId}:`)) throw new Error("Session model default owner differs");
      assertIdle(entry);
      const before = structuredClone(entry), after = structuredClone(entry);
      sdk.applyModelOverrideToSessionEntry({ entry: after, selection: { ...operation.desired, isDefault: true },
        explicitDefaultSelection: true, preserveAuthProfileOverride: true });
      if (recovery) after.updatedAt = recovery.originalUpdatedAt;
      else if (Object.hasOwn(before, "updatedAt")) after.updatedAt = before.updatedAt;
      else delete after.updatedAt;
      const patch = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(key => !isDeepStrictEqual(before[key], after[key]))
        .map(key => [key, after[key]]));
      const mutable = new Set(["modelOverrideSource", "providerOverride", "modelOverride", "modelOverrideRouteResolution",
        "modelOverrideFallbackOriginProvider", "modelOverrideFallbackOriginModel", "model", "modelProvider",
        "contextTokens", "contextTokensSource", "contextBudgetStatus", "fallbackNotice"]);
      if (recovery) mutable.add("updatedAt");
      if (Object.keys(patch).some(key => !mutable.has(key))) throw new Error("Native default selection changed unrelated session metadata");
      plans.push({ scope, sessionKey, before, after, patch, paths, recovery: Boolean(recovery), expectedActivitySha256: recovery?.expectedActivitySha256, originalWindowActivity: recovery?.originalWindowActivity });
    }
    if (found.size !== recoveries.size) throw new Error("Session model recovery predecessor missing");
  }
  // Validate every selected row before the first mutation. Later drift aborts activation,
  // whose existing recovery restores the complete predecessor state snapshot.
  const verifyActivity = plan => {
    if (!plan.recovery) return;
    const path = sdk.resolveOpenClawAgentSqlitePath({ agentId: plan.scope.agentId, env });
    assertStatePath(path);
    if (!plan.paths.includes(path)) throw new Error("Session model recovery activity database differs");
    const result = sdk.withOpenClawAgentDatabaseReadOnly(({ db }) => sessionModelDefaultActivityDigest(db, plan.sessionKey),
      { agentId: plan.scope.agentId, env, path });
    if (!result.found || result.value !== plan.expectedActivitySha256) throw new Error("Session model recovery activity changed");
  };
  const verify = plan => {
    check();
    for (const path of plan.paths) assertStatePath(path);
    if (!isDeepStrictEqual(sdk.getSessionEntry({ ...plan.scope, sessionKey: plan.sessionKey }), plan.before)) {
      throw new Error("Session model default predecessor changed");
    }
    verifyActivity(plan);
  };
  for (const plan of plans) verify(plan);
  for (const plan of plans) {
    verify(plan);
    const actual = await sdk.patchSessionEntry({ ...plan.scope, sessionKey: plan.sessionKey,
      ...(plan.recovery ? { restoreWindowActivity: plan.originalWindowActivity } : { preserveWindowActivity: true }),
      replaceEntry: plan.recovery, preserveActivity: true, preserveConversation: true, preservePrivateMetadata: true, skipMaintenance: true, requireWriteSuccess: true,
      assertCommitAllowed: () => { check(); for (const path of plan.paths) assertStatePath(path); verifyActivity(plan); },
      update(entry, context) {
        if (!context.existingEntry || !isDeepStrictEqual(entry, plan.before)) throw new Error("Session model default predecessor changed");
        assertIdle(entry);
        return plan.recovery ? structuredClone(plan.after) : plan.patch;
      },
    });
    // The native patch return can retain explicit undefined deletion keys. Check
    // the persisted public projection, which omits them just like the read plan.
    const persisted = sdk.getSessionEntry({ ...plan.scope, sessionKey: plan.sessionKey, readConsistency: "latest" });
    if (!actual || !isDeepStrictEqual(persisted, plan.after)) throw new Error("Session model default result differs");
  }
  check();
  return { changed: plans.filter(plan => !plan.recovery).length, recovered: plans.filter(plan => plan.recovery).length };
}
