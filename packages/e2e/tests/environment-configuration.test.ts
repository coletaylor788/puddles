import { describe, expect, it } from "vitest";
// @ts-expect-error Executable release module.
import { assertEnvironmentConfiguration, renderEnvironmentConfiguration, configurationDigest } from "../src/environment-configuration.mjs";
// @ts-expect-error Executable release module.
import { validateMigrationManifest } from "../src/native-state-migration.mjs";

const base = {
  gateway: { port: 18000 },
  agents: { defaults: { model: { primary: "example/model" } } },
  plugins: { entries: { memory: { enabled: true, config: { legacy: true } } } },
  tools: { deny: ["external-write"] },
  secrets: { providers: { local: { path: "/production/credentials.json" } } },
};
const bindings = [
  { path: "/gateway/port", category: "port", reason: "Separate listener" },
  { path: "/secrets/providers/local/path", category: "credential-reference", reason: "Local credential file" },
];
const overrides = { "/gateway/port": 18001, "/secrets/providers/local/path": "/test/credentials.json" };

describe("environment configuration", () => {
  it("isolates plugin approval destinations without changing approval behavior", () => {
    const plugin = { enabled: true, mode: "targets", agentFilter: ["main"], targets: [{ channel: "imessage", accountId: "default", to: "production-owner" }] };
    const config = { approvals: { plugin } };
    const path = "/approvals/plugin/targets/0/to";
    const rules = [{ path, category: "account", reason: "Recording approval destination" }];
    const selected = renderEnvironmentConfiguration(config, rules, { [path]: "fixture-owner" });
    expect(selected.approvals.plugin).toEqual({ ...plugin, targets: [{ ...plugin.targets[0], to: "fixture-owner" }] });
    expect(() => assertEnvironmentConfiguration(config, config, rules, { [path]: "fixture-owner" })).toThrow(/parity failed/);
    for (const field of ["enabled", "mode", "agentFilter/0", "targets/0/channel"]) {
      const path = `/approvals/plugin/${field}`;
      expect(() => renderEnvironmentConfiguration(config, [{ path, category: "account", reason: "Invalid override" }], { [path]: "changed" })).toThrow(/Unsupported|Behavior/);
    }
  });
  it("binds Rocket Money host executables and state without changing write permission", () => {
    const config = {plugins:{entries:{"rocket-money":{enabled:true,config:{command:"/host/python",chromeExecutable:"/host/chrome",stateDir:"/host/private",writesEnabled:true}}}}};
    const rules = ["command", "chromeExecutable", "stateDir"].map(field => ({path:`/plugins/entries/rocket-money/config/${field}`,category:field === "stateDir" ? "path" : "fixture",reason:"Synthetic transport"}));
    const result = renderEnvironmentConfiguration(config,rules,Object.fromEntries(rules.map(r => [r.path,"/fixture/isolated"])));
    expect(result.plugins.entries["rocket-money"].config.writesEnabled).toBe(true);
    for (const field of ["writesEnabled", "unknownCommand"]) {
      const path = `/plugins/entries/rocket-money/config/${field}`;
      expect(() => renderEnvironmentConfiguration(config,[{path,category:"fixture",reason:"Invalid"}],{[path]:false})).toThrow(/Unsupported|Behavior/);
    }
  });

  it("binds a synthetic FaceTime owner while preserving carrier enablement and Talk behavior", () => {
    const config = { plugins: { entries: { facetime: { enabled: true,
      config: { enabled: true, ownerHandles: ["owner@example.invalid"], realtime: { mode: "talk" } } } } } };
    const path = "/plugins/entries/facetime/config/ownerHandles/0";
    const rules = [{ path, category: "account", reason: "Synthetic caller" }];
    const result = renderEnvironmentConfiguration(config, rules, { [path]: "fixture@example.invalid" });
    expect(result.plugins.entries.facetime.config.ownerHandles).toEqual(["fixture@example.invalid"]);
    expect(result.plugins.entries.facetime.enabled).toBe(true);
    expect(result.plugins.entries.facetime.config.realtime).toEqual({ mode: "talk" });
    expect(() => assertEnvironmentConfiguration(config, config, rules, { [path]: "fixture@example.invalid" })).toThrow(/parity failed/);
    for (const invalid of ["enabled", "config/enabled", "config/realtime/mode", "config/ownerHandles"]) {
      const path = `/plugins/entries/facetime/${invalid}`;
      expect(() => renderEnvironmentConfiguration(config, [{ path, category: "account", reason: "Invalid override" }], { [path]: "changed" })).toThrow(/Unsupported|Behavior/);
    }
  });

  it.each(["defaults", "entries/main"])("isolates heartbeat delivery at %s without changing its schedule or model", (agent) => {
    const heartbeat = { every: "60m", model: "example/model", target: "example-channel", to: "prod-recipient", accountId: "prod-account" };
    const config = agent === "defaults"
      ? { agents: { defaults: { heartbeat } } }
      : { agents: { entries: { main: { heartbeat } } } };
    const fields = { target: "none", to: "fixture-recipient", accountId: "fixture-account" };
    const routing = Object.keys(fields).map((key) => ({ path: `/agents/${agent}/heartbeat/${key}`, category: "account", reason: "Isolated delivery" }));
    const selected = Object.fromEntries(Object.entries(fields).map(([key, value]) => [`/agents/${agent}/heartbeat/${key}`, value]));
    const result = renderEnvironmentConfiguration(config, routing, selected);
    const actual = agent === "defaults" ? result.agents.defaults.heartbeat : result.agents.entries.main.heartbeat;
    expect(actual).toEqual({ ...heartbeat, ...fields });
    expect(() => assertEnvironmentConfiguration(config, config, routing, selected)).toThrow(/Configuration parity failed/);
    for (const field of ["every", "model"]) {
      const path = `/agents/${agent}/heartbeat/${field}`;
      expect(() => renderEnvironmentConfiguration(config, [{ path, category: "account", reason: "Invalid behavior override" }], { [path]: "changed" })).toThrow(/Unsupported|Behavior/);
    }
  });

  it("renders only declared bindings and preserves legacy authored behavior", () => {
    const config = renderEnvironmentConfiguration(base, bindings, overrides);
    expect(config.gateway.port).toBe(18001);
    expect(config.plugins).toEqual(base.plugins);
    expect(config.secrets.providers.local.path).toBe("/test/credentials.json");
    expect(assertEnvironmentConfiguration(config, base, bindings, overrides).configSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(base.gateway.port).toBe(18000);
  });

  it.each(["missing-plugin", "disabled-plugin", "model", "permissions", "credential-substitution", "extra-default"])("rejects %s without printing values", (change) => {
    const config = renderEnvironmentConfiguration(base, bindings, overrides);
    if (change === "missing-plugin") delete config.plugins.entries.memory;
    if (change === "disabled-plugin") config.plugins.entries.memory.enabled = false;
    if (change === "model") config.agents.defaults.model.primary = "private-unexpected-value";
    if (change === "permissions") config.tools.deny = [];
    if (change === "credential-substitution") config.secrets.providers.local.path = "/production/credentials.json";
    if (change === "extra-default") config.agents.defaults.timeoutSeconds = 900;
    expect(() => assertEnvironmentConfiguration(config, base, bindings, overrides)).toThrow(/Configuration parity failed at/);
    try { assertEnvironmentConfiguration(config, base, bindings, overrides); } catch (error) {
      expect(String(error)).not.toContain("private-unexpected-value");
    }
  });

  it("rejects undeclared, missing, duplicate and broad overrides", () => {
    expect(() => renderEnvironmentConfiguration(base, bindings, { ...overrides, "/tools/deny": [] })).toThrow(/exactly/);
    expect(() => renderEnvironmentConfiguration(base, bindings, {})).toThrow(/exactly/);
    expect(() => renderEnvironmentConfiguration(base, [...bindings, bindings[0]], overrides)).toThrow(/Duplicate/);
    expect(() => renderEnvironmentConfiguration(base, [{ path: "/plugins", category: "fixture", reason: "invalid" }], {})).toThrow(/Unsupported|leaf/);
    expect(() => renderEnvironmentConfiguration(base, [{ path: "/plugins/entries/memory/enabled", category: "fixture", reason: "invalid" }], {})).toThrow(/Unsupported|Behavior/);
  });

  it("does not allow a fixture declaration to override a behavioral scalar", () => {
    expect(() => renderEnvironmentConfiguration({ tools: { profile: "minimal" } }, [
      { path: "/tools/profile", category: "fixture", reason: "must not bypass behavior" },
    ], { "/tools/profile": "full" })).toThrow(/Unsupported environment binding/);
  });

  it("permits only the supported path-valued service argument", () => {
    const path = "/models/providers/local/localService/args/1";
    const binding = [{ path, category: "path", reason: "Separate service files" }];
    const model = (args: string[]) => ({ models: { providers: { local: { localService: { args } } } } });
    expect(() => renderEnvironmentConfiguration(model(["--models-max", "2"]), binding, { [path]: "200" })).toThrow(/service path argument/);
    const result = renderEnvironmentConfiguration(model(["--models-preset", "/prod/models.ini"]), binding, { [path]: "/test/models.ini" });
    expect(result.models.providers.local.localService.args).toEqual(["--models-preset", "/test/models.ini"]);
  });

  it("allows a reviewed behavior transition while rejecting drift at either stage", () => {
    const candidate = structuredClone(base);
    candidate.agents.defaults.model.primary = "example/new-model";
    const before = renderEnvironmentConfiguration(base, bindings, overrides);
    const after = renderEnvironmentConfiguration(candidate, bindings, overrides);
    expect(() => assertEnvironmentConfiguration(before, base, bindings, overrides)).not.toThrow();
    expect(() => assertEnvironmentConfiguration(after, candidate, bindings, overrides)).not.toThrow();
    expect(() => assertEnvironmentConfiguration(after, base, bindings, overrides)).toThrow();
    expect(() => assertEnvironmentConfiguration(before, candidate, bindings, overrides)).toThrow();
  });

  it("ignores only enumerated bookkeeping fields", () => {
    expect(configurationDigest({ ...base, meta: { lastTouchedAt: "later" } })).toBe(configurationDigest(base));
    expect(configurationDigest({ ...base, meta: { unexpected: true } })).not.toBe(configurationDigest(base));
  });

  it("binds both configuration stages in a migration manifest", () => {
    const manifest = { schemaVersion: 1, configOperations: [{ kind: "set", path: ["example"], expected: { exists: false }, value: true }],
      configuration: { schemaVersion: 1, baseSha256: "a".repeat(64), bindingsSha256: "b".repeat(64), predecessorSha256: "c".repeat(64), candidateSha256: "d".repeat(64) } };
    expect(validateMigrationManifest(manifest)).toEqual(manifest);
    expect(() => validateMigrationManifest({ ...manifest, configuration: { ...manifest.configuration, candidateSha256: "missing" } })).toThrow(/parity/);
  });
});
