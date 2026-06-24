# Plan 026 — Multiplayer budget-guard hook (per-tier monthly + daily cap)

**Status:** 📝 Drafting (awaiting user review)
**Author:** Cole + Puddles
**Depends on:** [Plan 022](./022-household-and-friends-tiers.md) — household/friends tiers on MiniMax M2.5 (Azure Foundry) must be deployed first; this plan guards their spend.

---

## Summary

OpenClaw has no native per-day / per-month spend cap. The Azure subscription has a $150/mo hard ceiling (auto-disables, no credit card on file), but a busy first week could exhaust it and take household + friends offline for the rest of the month. This plan adds one `before_dispatch` claiming hook that:

1. Reads each tier's cumulative cost from OpenClaw's per-agent cost cache (`~/.openclaw/sessions/<agentId>/.usage-cost-cache.json`).
2. Computes today's spend per tier via snapshot-and-diff against a daily baseline.
3. Silently blocks new dispatches once the tier exceeds its **daily slice** (monthly budget ÷ 30).
4. Resets at local midnight (`America/Los_Angeles`).

Per-tier budgets:

| Tier | Monthly cap | Daily slice |
|---|---|---|
| household | **$100** | $3.33 |
| friends | **$50** | $1.67 |

Workers (reader, browser-agent) count against their parent tier's slice. Going offline for the rest of the day if a tier blows through its slice is acceptable — that's the design.

---

## Goals / non-goals

**Goals:**
- Each tier's monthly cap is guaranteed to last the full month even under sustained abuse.
- Zero-cost enforcement: blocked dispatches never hit the LLM.
- Drop-in: one hook file + one `openclaw.json` snippet, no upstream patch.
- Aligns naturally with Azure sub's $150 cap ($100 + $50 = $150 worst case).

**Non-goals:**
- Per-person quotas inside a tier (everyone in household shares the $100).
- Pre-flight token estimation (small over-shoot on the final turn of the day is tolerated).
- Anything for the `main` tier — it runs the local Claude provider and isn't on this budget.
- Polite "I'm out for today" replies — silent block is the v1 behavior (see Open Q 1).

---

## Architecture

### Hook event: `before_dispatch` (claiming)

`before_dispatch` fires before any LLM call when an agent is about to handle inbound work. It's a claiming hook — if the hook claims the dispatch, the agent never runs. Cost when blocked: $0.

### Cost source: OpenClaw's per-agent cost cache

Already maintained by OpenClaw at `~/.openclaw/sessions/<agentId>/.usage-cost-cache.json`. Schema (`USAGE_COST_CACHE_VERSION = 4`):

```jsonc
{
  "totalCost": 12.345,        // cumulative USD across all turns for this agent
  "inputCost": 4.0,
  "outputCost": 7.0,
  "cacheReadCost": 1.0,
  "cacheWriteCost": 0.3,
  "totalTokens": 1234567,
  // ...
}
```

The hook reads `totalCost` for each agent in a tier, sums them, and compares against a per-tier daily baseline.

### Day boundary

Calendar day in `America/Los_Angeles`. At first dispatch after midnight local, the hook snapshots `totalCost` per tier as that day's baseline. Subsequent dispatches compute `todaySpend = currentSum − baselineSum`.

### State file

Hook owns its own state at `~/.openclaw/state/budget-guard.json`:

```jsonc
{
  "household": { "date": "2026-06-05", "baselineUSD": 41.20 },
  "friends":   { "date": "2026-06-05", "baselineUSD": 18.05 }
}
```

Logic each dispatch:
1. Resolve the agent's tier (`household` if agentId ∈ {household, household-reader, household-browser-agent}, same for `friends`; else allow and exit).
2. Read state file; if `state[tier].date !== today` → reset `baselineUSD = currentSum`, write back.
3. `todaySpend = currentSum − state[tier].baselineUSD`
4. If `todaySpend >= dailySlice[tier]` → **claim** the dispatch (block silently). Else allow.

Self-healing on weirdness: if `currentSum < baselineUSD` (cache cleared / agent removed) → reset baseline to `currentSum` and allow this turn.

### Worker-to-tier mapping

Hard-coded in v1 (matches Plan 022's agent IDs):

```js
const TIER_AGENTS = {
  household: ["household", "household-reader", "household-browser-agent"],
  friends:   ["friends",   "friends-reader",   "friends-browser-agent"],
};
```

### Behavior when blocked

Silent claim — the agent simply doesn't reply. Per user: "may go offline for the rest of the day" is the intended UX. No polite "back tomorrow" reply (see Open Q 1 if Cole wants to revisit).

---

## Hook layout

OpenClaw loads hooks as directories under `~/.openclaw/hooks/<name>/`
(each containing a `HOOK.md` frontmatter file and a handler entrypoint).

**`~/.openclaw/hooks/budget-guard/HOOK.md`:**

```yaml
---
name: budget-guard
description: "Per-tier daily/monthly USD cap for household + friends. Reads OpenClaw's per-agent cost cache; claims dispatches that would exceed the tier's daily slice."
metadata:
  openclaw:
    events: ["before_dispatch"]
---
```

**`~/.openclaw/hooks/budget-guard/handler.js`** (~70 lines):

```js
// before_dispatch: enforce per-tier daily/monthly spend caps for household + friends.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const SESSIONS_DIR = join(homedir(), ".openclaw", "sessions");
const STATE_FILE   = join(homedir(), ".openclaw", "state", "budget-guard.json");
const TZ = "America/Los_Angeles";

const TIER_AGENTS = {
  household: ["household", "household-reader", "household-browser-agent"],
  friends:   ["friends",   "friends-reader",   "friends-browser-agent"],
};

const MONTHLY_USD = {
  household: Number(process.env.BUDGET_HOUSEHOLD_USD ?? 100),
  friends:   Number(process.env.BUDGET_FRIENDS_USD   ?? 50),
};
const DAILY_USD = Object.fromEntries(
  Object.entries(MONTHLY_USD).map(([t, m]) => [t, m / 30]),
);

function todayLocal() {
  // YYYY-MM-DD in America/Los_Angeles
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function tierFor(agentId) {
  for (const [tier, ids] of Object.entries(TIER_AGENTS)) {
    if (ids.includes(agentId)) return tier;
  }
  return null;
}

function readAgentCost(agentId) {
  try {
    const path = join(SESSIONS_DIR, agentId, ".usage-cost-cache.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Number(data?.totalCost ?? 0);
  } catch {
    return 0; // session not started yet
  }
}

function tierTotal(tier) {
  return TIER_AGENTS[tier].reduce((s, id) => s + readAgentCost(id), 0);
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export default async function beforeDispatch({ agentId }) {
  const tier = tierFor(agentId);
  if (!tier) return { ok: true };       // main + everything else: not our problem

  const today    = todayLocal();
  const current  = tierTotal(tier);
  const state    = loadState();
  const prev     = state[tier];

  let baseline;
  if (!prev || prev.date !== today || current < prev.baselineUSD) {
    baseline = current;
    state[tier] = { date: today, baselineUSD: baseline };
    saveState(state);
  } else {
    baseline = prev.baselineUSD;
  }

  const todaySpend = current - baseline;
  if (todaySpend >= DAILY_USD[tier]) {
    console.error(
      `[budget-guard] BLOCK ${agentId} (tier=${tier} spent=$${todaySpend.toFixed(2)} cap=$${DAILY_USD[tier].toFixed(2)})`,
    );
    return { claimed: true, reply: null }; // silent block; agent does not respond
  }
  return { ok: true };
}
```

(Exact return shape — `{ claimed: true, reply: null }` vs whatever OpenClaw's claiming-hook contract is — to be confirmed by reading `hook-runner-global-CBGmN_LW.js` during implementation. Pattern matches the existing `sessions-send-cron-target-allowlist` hook from Plan 022.)

---

## Files / changes

| Path | Change |
|---|---|
| `~/.openclaw/hooks/budget-guard/HOOK.md` | **new** — hook frontmatter declaring `before_dispatch` event |
| `~/.openclaw/hooks/budget-guard/handler.js` | **new** — hook source (~70 lines) |
| `~/.openclaw/state/budget-guard.json` | **new** (auto-created at first dispatch) |
| `~/.openclaw/openclaw.json` | enable `budget-guard` under `hooks.internal.entries` |
| `~/.openclaw/.env` (or wherever env is loaded) | optional `BUDGET_HOUSEHOLD_USD=100`, `BUDGET_FRIENDS_USD=50` |
| `docs/openclaw-setup/03-openclaw-and-agent-sandboxing.md` | new short subsection under the multiplayer-agent section pointing at this plan |

No upstream patch. No new dependencies. Pure stdlib Node.

`openclaw.json` snippet:

```jsonc
{
  "hooks": {
    "internal": {
      "entries": {
        // ...existing entries from Plan 022 (message-chat-pin, sessions-send-cron-target-allowlist)
        "budget-guard": { "enabled": true }
      }
    }
  }
}
```

The hook's `before_dispatch` event registration comes from
`HOOK.md`'s `metadata.openclaw.events`, not from `openclaw.json`.

---

## Sequencing

1. Deploy Plan 022 (household + friends tiers live, MiniMax-via-Foundry working).
2. Create `~/.openclaw/hooks/budget-guard/` with `HOOK.md` + `handler.js`. Enable the hook by adding `"budget-guard": { "enabled": true }` to `hooks.internal.entries` in `openclaw.json`. Restart OpenClaw daemon (or reload hooks if hot-reload supported).
3. Smoke test: send one message to household; confirm dispatch completes and `~/.openclaw/state/budget-guard.json` shows today's date + a baseline.
4. Forced-block test: set `BUDGET_HOUSEHOLD_USD=0.01`, send a message, confirm silent block + the `[budget-guard] BLOCK …` log line, then restore.
5. Day-rollover test: edit state file to set yesterday's date, send a message, confirm baseline resets and dispatch proceeds.

---

## Test plan

- [ ] **Unit-style:** drive `beforeDispatch` with a temp `SESSIONS_DIR` / `STATE_FILE` and synthetic cost caches. Cases:
  - No state → creates entry, allows.
  - Date change → resets baseline, allows.
  - Cost decreased (cache cleared) → resets baseline, allows.
  - Spend below daily cap → allows.
  - Spend ≥ daily cap → claims (blocks).
  - `agentId` not in any tier → allows immediately.
- [ ] **Integration on mini:**
  - Real household message → allowed, state updated.
  - Forced low cap → blocked, no LLM call (verify via OpenClaw logs).
  - Reset cap, message again same day → still blocked until baseline reset (manual edit) or midnight.
  - Cross-tier independence: blocking household does not block friends.

---

## Pre-flight (for Cole to do once)

- [ ] Confirm Plan 022 is deployed and household + friends are answering on MiniMax-via-Foundry.
- [ ] Confirm `~/.openclaw/sessions/household/.usage-cost-cache.json` (and the 5 siblings) exist and contain a sensible `totalCost` after a few messages — the hook depends on this format being unchanged.
- [ ] Decide Open Q 1 (silent block vs polite reply).
- [ ] Decide Open Q 2 (calendar day vs 24h rolling window).

---

## Open questions

1. **Block UX — silent or polite?** v1 silent (no reply at all). Alternative: a single "I've hit today's spend limit, back after midnight PT — Puddles" reply once per day per tier (requires state to track "already-notified-today"). Cole said "may go offline for the rest of the day," which reads silent — go with silent unless it confuses household.
2. **Day boundary semantics.** Calendar day in `America/Los_Angeles` is the obvious choice; alternative is a 24h rolling window keyed off first-spend timestamp. Calendar day is simpler, predictable, and lines up with how humans think about "today's budget."
3. **Should `main` (Cole's tier, local Claude) be exempt?** Yes — it doesn't hit Azure. Hook returns `ok: true` for any `agentId` not in `TIER_AGENTS`. Confirming this is the intent.
4. **What if `before_dispatch`'s payload doesn't expose `agentId` under that exact name?** Verify against `hook-runner-global-CBGmN_LW.js` and the existing Plan 022 hooks (`message-chat-pin`, `sessions-send-cron-target-allowlist`) during implementation. If the field is named differently (`sessionId`, `targetAgent`, etc.) the resolver is a one-line change.
5. **Coordinating with the Azure sub cap.** $100 + $50 = $150 = sub cap. If Cole keeps the Azure cap at $150 exactly, a single tier going wild can't starve the other (each is capped independently here, so household maxing out leaves friends' $50 untouched). If the cap is lowered later, the daily slices still apply, but the sub cap will hit first — acceptable.
6. **Pre-flight token estimate?** Skipped in v1. If household repeatedly nudges past the cap by big margins on the last turn of the day, we can add a `before_prompt_build` pre-estimate later that adds projected output cost. Probably unnecessary at $3.33/day with ~$0.005 typical turn cost.
7. **Verify the cost-cache path actually exists at runtime.** Plan assumes `~/.openclaw/sessions/<agentId>/.usage-cost-cache.json`, but `~/.openclaw/sessions/` doesn't exist on the mini today (pre-rollout). The directory is presumably created lazily on the agent's first turn — confirm by either: (a) sending a turn to `main` after Plan 022 lands and checking that `~/.openclaw/sessions/main/.usage-cost-cache.json` materializes with the expected schema, or (b) greping the installed OpenClaw for the cache-write site (`USAGE_COST_CACHE_VERSION` / `.usage-cost-cache`) to confirm both the path and the writer's atomicity guarantees. If the path differs in this OpenClaw version, the `SESSIONS_DIR`/filename constants in the hook are a one-line fix. Resolve before implementing.

---

## Verify-at-deploy

- [ ] Hook loads without error (no syntax issue, OpenClaw logs the registration).
- [ ] Real household message lands, state file appears with today's date.
- [ ] Forced-block scenario confirms zero LLM cost when blocked (check provider logs / cost cache: `totalCost` should not change on a blocked dispatch).
- [ ] Friends works after household is blocked (independence).
- [ ] After midnight PT, both tiers reactivate without restart.
