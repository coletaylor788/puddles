import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  ContactsEgressGuard,
  ContactsTrustResolver,
  InjectionGuard,
  SecretRedactor,
  loadLLMProvider,
  type IngressHook,
  type LLMClient,
} from "mcp-hooks";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { getBridge, shutdownAll, type BridgeSpec } from "./bridge-cache.js";
import { calendarPrefilter } from "./prefilter.js";
import {
  wrapMcpTool,
  type AuditEntry,
  type AuditLogger,
  type McpCaller,
} from "./wrap-tool.js";
import {
  calendarExtractDestinations,
  READ_ACTIONS,
  selectHooksForCalendar,
  WRITE_ACTIONS,
  type CalendarAction,
  type CalendarHooks,
} from "./action-map.js";

interface SecureAppleCalendarConfig {
  applePimMcpCommand: string;
  applePimMcpArgs?: string[];
  applePimMcpCwd?: string;
  applePimMcpEnv?: Record<string, string>;
  /**
   * Gateway-level default `APPLE_PIM_CONFIG_DIR`. Used when an agent has no
   * per-agent `<workspaceDir>/apple-pim/config.json`. Lower priority than
   * the workspace config; higher than `process.env.APPLE_PIM_CONFIG_DIR`.
   */
  configDir?: string;
  trustedAttendeeDomains?: string[];
  /** Override path to the contacts-cli binary. Defaults to "contacts-cli" on PATH. */
  contactsCliPath?: string;
  /**
   * Module specifier whose default export is a class implementing
   * mcp-hooks' `LLMClient` interface. The plugin dynamic-imports this and
   * constructs `new Provider({ model, ...llmProviderOptions })` at startup.
   */
  llmProvider: string;
  /** Forwarded verbatim to the provider class constructor (merged with `{ model }`). */
  llmProviderOptions?: Record<string, unknown>;
  /** Model id forwarded to the provider class constructor. */
  model?: string;
  /** Override path for the audit log file. */
  auditLogPath?: string;
}

const DEFAULT_AUDIT_LOG_PATH = `${homedir()}/.openclaw/logs/secure-apple-calendar-audit.jsonl`;

/**
 * Hardcoded `calendar` tool definition matching apple-pim's
 * mcp-server `lib/schemas.js`. We register this synchronously inside
 * `register()` because OpenClaw's plugin loader snapshots `api.registerTool`
 * calls synchronously — any registration deferred to a later tick (e.g.
 * after `bridge.listTools()`) is silently dropped.
 *
 * apple-pim ships 5 consolidated MCP tools (calendar, reminder, contact,
 * mail, apple-pim). This plugin intentionally exposes ONLY `calendar`. The
 * other 4 are not registered, so the agent never sees them — defense in
 * depth on top of any apple-pim per-domain config.
 */
const CALENDAR_TOOL: McpTool = {
  name: "calendar",
  description:
    "Manage macOS Calendar events (works with iCloud, Google, Outlook, and any " +
    "calendar account added to macOS Calendar.app). Actions: " +
    "list (calendars), events (query by date range), get (by ID), search (by text), " +
    "create, update, delete, batch_create, schema (show input schema).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "list",
          "events",
          "get",
          "search",
          "create",
          "update",
          "delete",
          "batch_create",
          "schema",
        ],
        description: "Operation to perform",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Limit returned fields to these keys (e.g. ['id','title','start']). Reduces token usage.",
      },
      dryRun: {
        type: "boolean",
        description:
          "If true, validate inputs and return a preview of what the operation would do without executing it. Only applies to mutation actions (create, update, delete, batch_create).",
      },
      id: { type: "string", description: "Event ID (get/update/delete)" },
      calendar: { type: "string", description: "Calendar name or ID" },
      query: { type: "string", description: "Search query (search)" },
      from: { type: "string", description: "Start date (events/search)" },
      to: { type: "string", description: "End date (events/search)" },
      lastDays: { type: "number", description: "Include events from N days ago" },
      nextDays: { type: "number", description: "Include events up to N days ahead" },
      limit: { type: "number", description: "Maximum results" },
      title: { type: "string", description: "Event title (create/update)" },
      start: { type: "string", description: "Start date/time (create/update)" },
      end: { type: "string", description: "End date/time (create/update)" },
      duration: { type: "number", description: "Duration in minutes (create)" },
      location: { type: "string", description: "Event location" },
      notes: { type: "string", description: "Event notes" },
      allDay: { type: "boolean", description: "All-day event" },
      alarm: {
        type: "array",
        items: { type: "number" },
        description: "Alarm minutes before event",
      },
      url: { type: "string", description: "URL" },
      attendees: {
        type: "array",
        description:
          "Event attendees (create/update). Replaces all existing attendees on update.",
        items: {
          type: "object",
          properties: {
            email: { type: "string", description: "Email address (required)" },
            name: { type: "string", description: "Display name" },
            role: {
              type: "string",
              description: "required, optional, chair, or nonParticipant",
            },
          },
          required: ["email"],
        },
      },
      recurrence: {
        type: "object",
        description: "Recurrence rule for repeating events",
        properties: {
          frequency: {
            type: "string",
            enum: ["daily", "weekly", "monthly", "yearly", "none"],
          },
          interval: { type: "number" },
          endDate: { type: "string" },
          occurrenceCount: { type: "number" },
          daysOfTheWeek: { type: "array", items: { type: "string" } },
          daysOfTheMonth: { type: "array", items: { type: "number" } },
        },
        required: ["frequency"],
      },
      futureEvents: {
        type: "boolean",
        description: "Apply to future occurrences (update/delete recurring)",
      },
      events: {
        type: "array",
        description: "Events array (batch_create)",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            duration: { type: "number" },
            calendar: { type: "string" },
            location: { type: "string" },
            notes: { type: "string" },
            url: { type: "string" },
            allDay: { type: "boolean" },
            alarm: { type: "array", items: { type: "number" } },
            attendees: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  email: { type: "string" },
                  name: { type: "string" },
                  role: { type: "string" },
                },
                required: ["email"],
              },
            },
          },
        },
      },
    },
    required: ["action"],
  },
};

function createAuditLogger(api: OpenClawPluginApi, filePath: string): AuditLogger {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (err) {
    api.logger.warn?.(
      `[secure-apple-calendar] could not create audit log directory ${dirname(filePath)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return (entry: AuditEntry) => {
    const findings =
      entry.findingTypes && entry.findingTypes.length > 0
        ? ` types=${entry.findingTypes.join(",")}`
        : "";
    api.logger.info?.(
      `[secure-apple-calendar][audit] tool=${entry.toolName} phase=${entry.phase} hook=${entry.hookName} action=${entry.action} contentLen=${entry.contentLen}${findings}${
        entry.reason ? ` reason="${entry.reason}"` : ""
      }`,
    );
    try {
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (err) {
      api.logger.warn?.(
        `[secure-apple-calendar] failed to append audit entry: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
}

/**
 * Build a narrowed clone of `CALENDAR_TOOL` for one OpenClaw-facing
 * registration. The advertised `action` enum is restricted to `actions`,
 * the tool name and description are overridden, and the rest of the
 * schema is reused unchanged.
 *
 * The agent only sees the actions it can perform — but we still enforce
 * the gate at runtime in `restrictActionsCaller` (defence in depth).
 */
function narrowCalendarTool(
  name: string,
  description: string,
  actions: ReadonlySet<CalendarAction>,
): McpTool {
  const schema = CALENDAR_TOOL.inputSchema as McpTool["inputSchema"] & {
    properties: Record<string, unknown>;
  };
  const actionList = Array.from(actions);
  return {
    name,
    description,
    inputSchema: {
      ...schema,
      type: "object",
      properties: {
        ...schema.properties,
        action: {
          type: "string",
          enum: actionList,
          description: `Operation to perform (${actionList.join(", ")}).`,
        },
      },
    },
  };
}

/**
 * Wrap the lazy MCP caller so:
 *   1. We reject calls whose `action` is outside `allowed` (defence in depth
 *      on top of the schema enum), without spawning a bridge call.
 *   2. We rewrite the bridge call from the OpenClaw-facing name (e.g.
 *      `calendar_read`) back to the underlying MCP tool name `calendar`.
 */
function restrictActionsCaller(
  inner: McpCaller,
  openclawToolName: string,
  allowed: ReadonlySet<CalendarAction>,
  api: Pick<OpenClawPluginApi, "logger">,
): McpCaller {
  return {
    async callTool(_name: string, args: Record<string, unknown>) {
      const action = String(args?.action ?? "");
      if (!allowed.has(action as CalendarAction)) {
        const allowedList = Array.from(allowed).join(", ");
        const msg =
          `[secure-apple-calendar] ${openclawToolName} does not allow ` +
          `action="${action}". Allowed: ${allowedList}.`;
        api.logger?.warn?.(msg);
        return {
          content: [{ type: "text", text: msg }],
          isError: true,
        };
      }
      return inner.callTool("calendar", args);
    },
  };
}

/**
 * Subset of OpenClaw's `OpenClawPluginToolContext` we depend on. The full
 * type isn't re-exported on `openclaw/plugin-sdk`'s public surface, but the
 * runtime always supplies these fields (verified in
 * `node_modules/openclaw/dist/plugin-sdk/src/plugins/tool-types.d.ts`).
 */
interface PluginToolCtx {
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
}

/**
 * Resolve the apple-pim config dir for a given agent ctx.
 *
 *   1. `<ctx.workspaceDir>/apple-pim/config.json` exists  → use that dir
 *   2. `pluginConfig.configDir`                           → gateway default
 *   3. `process.env.APPLE_PIM_CONFIG_DIR`                 → env override
 *   4. undefined                                          → apple-pim's own
 *                                                           ~/.config/apple-pim/
 *
 * The bridge cache treats undefined as a single shared "<default>" slot, so
 * agents without per-agent config all share the global bridge — preserves the
 * pre-021 behavior on upgrade.
 */
function resolveConfigDirForAgent(
  ctx: PluginToolCtx,
  pluginConfig: Partial<SecureAppleCalendarConfig>,
): string | undefined {
  if (ctx.workspaceDir) {
    const candidate = join(ctx.workspaceDir, "apple-pim");
    if (existsSync(join(candidate, "config.json"))) return candidate;
  }
  if (pluginConfig.configDir) return pluginConfig.configDir;
  if (process.env.APPLE_PIM_CONFIG_DIR) return process.env.APPLE_PIM_CONFIG_DIR;
  return undefined;
}

const secureAppleCalendarPlugin = {
  id: "secure-apple-calendar",
  name: "Secure Apple Calendar",
  description:
    "Wraps apple-pim's calendar MCP tool with prompt-injection + secret-redaction (ingress) and ContactsEgressGuard (egress) hooks.",

  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig ?? {}) as Partial<SecureAppleCalendarConfig>;

    if (!config.applePimMcpCommand) {
      api.logger.error?.(
        "[secure-apple-calendar] missing required config: applePimMcpCommand",
      );
      return;
    }
    if (!config.applePimMcpArgs || config.applePimMcpArgs.length === 0) {
      api.logger.error?.(
        "[secure-apple-calendar] missing required config: applePimMcpArgs (e.g. ['/abs/path/to/apple-pim/mcp-server/dist/server.js'])",
      );
      return;
    }
    if (!config.llmProvider) {
      api.logger.error?.(
        "[secure-apple-calendar] missing required config: llmProvider (module specifier whose default export implements mcp-hooks LLMClient)",
      );
      return;
    }

    // Hooks, LLM, audit, trust resolver are SHARED across all agents — the
    // security wrappers don't depend on per-agent identity. Only the bridge
    // (and thus the apple-pim allow/blocklist) varies per agent.
    //
    // The LLM provider is dynamic-imported lazily on first hook call so plugin
    // registration stays sync and bad provider config surfaces in the audit
    // log at first use rather than wedging the gateway at startup.
    const providerSpec = config.llmProvider;
    const providerOptions: Record<string, unknown> = {
      ...(config.llmProviderOptions ?? {}),
    };
    if (config.model !== undefined) providerOptions.model = config.model;
    let providerPromise: Promise<LLMClient> | null = null;
    const llm: LLMClient = {
      async classify(content, prompt, options) {
        if (!providerPromise) {
          providerPromise = loadLLMProvider(providerSpec, providerOptions);
        }
        const real = await providerPromise;
        return real.classify(content, prompt, options);
      },
    };
    const contacts = new ContactsTrustResolver({
      cliPath: config.contactsCliPath,
      logger: { warn: (m) => api.logger.warn?.(m) },
    });
    const trustedDomains = (config.trustedAttendeeDomains ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter((d) => d.length > 0);
    const ingress: IngressHook[] = [
      new InjectionGuard({ llm, prefilter: calendarPrefilter }),
      new SecretRedactor({ llm, prefilter: calendarPrefilter }),
    ];
    const egressGuard = new ContactsEgressGuard({
      contacts,
      trustedDomains,
      extractDestinations: calendarExtractDestinations,
      llm,
    });
    const calendarHooks: CalendarHooks = { ingress, egress: [egressGuard] };

    const auditLogPath = config.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH;
    const audit = createAuditLogger(api, auditLogPath);

    const baseBridgeSpec = (configDir: string | undefined): BridgeSpec => ({
      command: config.applePimMcpCommand!,
      args: config.applePimMcpArgs!,
      cwd: config.applePimMcpCwd,
      baseEnv: config.applePimMcpEnv,
      configDir,
    });

    const CALENDAR_READ_TOOL = narrowCalendarTool(
      "calendar_read",
      "Read macOS Calendar events and metadata (works with iCloud, Google, " +
        "Outlook, and any calendar account added to macOS Calendar.app). " +
        "Read-only: list calendars, query events by date range, get by ID, " +
        "search by text, schema (show input schema). Cannot mutate.",
      READ_ACTIONS,
    );
    const CALENDAR_WRITE_TOOL = narrowCalendarTool(
      "calendar_write",
      "Create, update, or delete macOS Calendar events. Mutating only — use " +
        "`calendar_read` to query. Events with attendees are gated by an " +
        "egress guard; events with no attendees pass through unhooked.",
      WRITE_ACTIONS,
    );

    api.logger.info?.(
      `[secure-apple-calendar] registering 2 factory tools (audit log: ${auditLogPath}, trusted domains: ${
        trustedDomains.length > 0 ? trustedDomains.join(",") : "<none>"
      }): calendar_read, calendar_write`,
    );

    /**
     * Build a per-agent OpenClaw tool. Called by OpenClaw at descriptor
     * resolution time (cached per agent ctx — see plan 021), so the bridge
     * spec is closure-captured per agent rather than re-resolved every call.
     */
    const buildFactory = (
      tool: McpTool,
      openclawToolName: string,
      allowedActions: ReadonlySet<CalendarAction>,
    ) => (ctx: PluginToolCtx) => {
      const configDir = resolveConfigDirForAgent(ctx, config);
      api.logger.debug?.(
        `[secure-apple-calendar] resolving ${openclawToolName} for agent=${
          ctx.agentId ?? "<no-id>"
        } workspace=${ctx.workspaceDir ?? "<none>"} configDir=${
          configDir ?? "<apple-pim default>"
        }`,
      );
      const spec = baseBridgeSpec(configDir);
      const lazyCaller: McpCaller = {
        callTool: async (_name: string, args: Record<string, unknown>) => {
          const bridge = await getBridge(spec);
          // OpenClaw-facing names are calendar_read / calendar_write; the
          // underlying MCP tool is always `calendar`.
          return bridge.callTool("calendar", args);
        },
      };
      return wrapMcpTool(
        tool,
        restrictActionsCaller(lazyCaller, openclawToolName, allowedActions, api),
        {
          selectHooks: (args) => selectHooksForCalendar(args, calendarHooks),
          audit,
          source: "secure-apple-calendar",
        },
      );
    };

    api.registerTool(
      buildFactory(CALENDAR_READ_TOOL, "calendar_read", READ_ACTIONS),
    );
    api.registerTool(
      buildFactory(CALENDAR_WRITE_TOOL, "calendar_write", WRITE_ACTIONS),
    );

    api.on("session_end", async () => {
      await shutdownAll();
    });
  },
};

export default secureAppleCalendarPlugin;
