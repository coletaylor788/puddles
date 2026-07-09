# Plan 030: Apple Notes integration (share-with-Puddles, contacts-gated)

**Status:** ⏸️ **PAUSED (2026-07-08)** — parked pending the `sessions_yield` regression investigation. Design + research-complete below; resume when ready. 📝 Draft — **research-complete** (2026-07-07 on-mini probe + web research resolved the open questions; one small on-mini validation remains, and it no longer gates the security model). Model: **people share notes/folders *with* `puddles@`; Puddles reads them because a human accepted the share and the sharer is in Puddles's Contacts.**
**Author:** Cole + Puddles
**Depends on:**
- Plan 018 (`contacts as trust`) — `ContactsTrustResolver`, the read gate. **Central.**
- Plan 022 (`household`/`friends` tiers) — the contact→tier mapping a shared folder inherits from its sharer.
- Plan 021 / 017 (`secure-apple-calendar` per-agent config + wrapper/hook pattern) — the plugin scaffold + config-dir factory.
- Plan 010 (`secure-gmail`) + Plan 027 (iMessage approval channel) — path **B**: detect invite emails to `puddles@`, then one-tap approve. Plan 023 (durable browser login) — optional path **C**.
- `docs/openclaw-setup/apple-pim/` (disclaim wrapper) — TCC-stability for a `notes-cli`.

---

## Summary

Puddles reads/writes Apple Notes **on its own `puddles@` account**, where trusted people **share a folder with `puddles@`**:

- Apple share acceptance **can't be silently automated** — but the sharer **is** identifiable before accepting (invite email + `CKFetchShareMetadata`), so Puddles can contacts-filter without spam. The design supports "a friend shares a note with Puddles" two ways (see [that section](#supporting-a-friend-shares-a-note-with-puddles)): **(A)** known friends use a `puddles@`-owned shared folder → fully hands-off; **(B)** ad-hoc shares are auto-detected, contacts-filtered, and reduced to **one pre-vetted tap** to accept.
- Puddles's automated job is the **read-gate**, not acceptance: a note is read only if its folder's sharer resolves to a Contact and is mapped to a tier — at **tier-trust**, same as an iMessage from that person (no worker isolation).

The security does **not** depend on any fragile parsing — the human accept + config mapping carries it. A best-effort SQLite read of the CloudKit share record *auto-verifies* the sharer is a Contact and auto-suggests the tier, but is optional.

---

## Key findings (what the research settled)

**On-mini probe (2026-07-07):**
1. **Per-Apple-ID; the mini runs `puddles@`, which is empty** (2 default folders, 0 notes, 0 shares). Cole's own notes live on `cole@` and stay there (the `puddles@ ≠ cole@` split is load-bearing for Plan 022). ⇒ Puddles can only see notes **shared into `puddles@`** — which is exactly the model.
2. **AppleScript exposes `shared: true/false` on a note/folder, but no owner/participant/sharer** (`Notes.sdef`). Sharer identity must come from SQLite.
3. **`NoteStore.sqlite` carries the share plumbing** — `ZICNOTEPARTICIPANT` (opaque CloudKit IDs), `ZICINVITATION`, and `ZICCLOUDSYNCINGOBJECT.ZSERVERSHAREDATA` (the `CKShare` blob). Readable by the `puddles` user (no FDA wall over SSH).

**Web research:**
4. **Acceptance is mandatory and manual.** Apple has no auto-accept; `CKAcceptSharesOperation` requires user interaction; no AppleScript/Shortcuts hook exists. A share to `puddles@` **does not appear until a human accepts it.** ⇒ We lean into this: the accept is the trust gate, and **folder-level sharing = accept once**.
5. **The sharer's email/phone lives in the `ZSERVERSHAREDATA` `CKShare` blob** (`participants[].userIdentity.lookupInfo.{emailAddress,phoneNumber}`), unarchivable via NSKeyedUnarchiver (forensic parsers do this, e.g. `apple_cloud_notes_parser`). **Caveats:** blob format drifts across macOS versions, and modern iOS/macOS sometimes **obfuscates** the participant email. ⇒ usable for *auto-verify*, too fragile to be *load-bearing*.
6. **Shortcuts/App Intents** support Find/Create/Append/Get-Details/Delete (plain-text) but **no folder create/move and no sharing metadata**. ⇒ a viable *fallback* CRUD backend, but AppleScript is richer (HTML body, folders) and neither exposes sharers — SQLite is unavoidable for identity.
7. **Maintained Apple-Notes MCP servers exist** (e.g. `mcp-apple-notes`, `apple-notes-mcp`, `disco-trooper/apple-notes-mcp`, `sweetrb/apple-notes-mcp`, `apj72/notes_mcp`) — all AppleScript/SQLite CRUD + search; **none handle sharing/participants.** ⇒ reuse is possible for CRUD, but the contacts-gate is ours regardless → build a small `notes-cli`.
8. **Acceptance can't be *silently* automated — but the sharer *is* knowable pre-accept, and a browser path exists.** Deep research (2026-07-07) refined finding #8's earlier "hard wall":
   - **Silent auto-accept is blocked** (no AppleScript/Shortcuts accept; `CKAcceptSharesOperation` needs user interaction and can't touch Apple's private `com.apple.notes` container).
   - **BUT the sharer is knowable *before* accepting:** `CKFetchShareMetadataOperation` returns `ownerIdentity` (name/email/phone) from the share URL without joining, and the invitation **email** ("*<Sharer> via iCloud* invited you to collaborate on '<title>'" + a "View Note" link) carries the sharer name + link. ⇒ Puddles can **contacts-filter before it ever bothers a human** (no stranger spam).
   - **iCloud.com can accept + read shared notes in a browser** (Puddles has a durable-login browser-agent, plan 023) — but web automation is **fragile**: ~30-day "trust this browser" then re-2FA, ~2h inactivity timeouts, anti-bot friction, and against Apple's ToS. App-specific passwords work for IMAP/CalDAV, **not** web login.
   ⇒ See [Supporting "a friend shares a note with Puddles"](#supporting-a-friend-shares-a-note-with-puddles) for the four paths and the chosen design (**A + B**).

---

## Access & trust model

```
partner / friend / Cole  ── shares a FOLDER with puddles@ ──►  invitation
                                                                   │  (manual, one-time)
                                              Cole ACCEPTS on puddles@ (mini GUI / puddles@ device)
                                                                   │  ← primary trust gate (human)
                                              + adds 1 config line: folder → { tier, sharer }
                                                                   ▼
                                     folder's notes flow into puddles@ automatically thereafter
                                                                   │
                     notes-cli (only touches configured folders) ──┤
                                                                   ├─ read at the folder's TIER, tier-trust (no worker)
                                                                   └─ optional: verify sharer ∈ Contacts via CKShare blob
```

**Two-layer gate (belt = human, suspenders = automation):**

1. **Accept-time human gate (primary, robust).** A folder is only readable after a human accepts the CloudKit share *and* records it in config with its tier + expected sharer. Apple's mandatory-accept requirement means nothing enters `puddles@` un-vetted. No parsing, no fragility.
2. **Contacts auto-verify (optional enhancement).** `notes-cli` reads the folder's `ZSERVERSHAREDATA` and confirms the owner/participants resolve to `puddles@` Contacts (`ContactsTrustResolver`), and can auto-suggest the tier from Plan 022's contact→tier map. If the blob parse fails or the email is obfuscated, it **falls back to the config attestation** — no loss of safety, just less automation.

### Who accepts — the share-out inversion

Acceptance can't be automated (finding #8), so the design **minimizes** it rather than automating it. Prefer having **`puddles@` own the shared folder and invite people *out***, instead of people sharing *in*:

- Cole (one-time, on the mini GUI / a `puddles@` device) creates a per-tier folder (`Household`, `Friends`) on `puddles@` and invites the partner/friend. **They accept on *their* device** (normal human flow). `puddles@` **owns** it, so it never accepts anything — their notes just sync in and Puddles reads them.
- Initiating a share is also GUI-only (no AppleScript/Shortcuts command), so this is a one-time human setup per folder; after that it's hands-off forever.
- **Share-*in* is the fallback** (someone shares a folder *into* `puddles@`) — it needs a human to accept on `puddles@` each time, so reserve it for one-offs and steer recurring sharing to the owned folders.

**Puddles's automated role is the read-gate, not acceptance.** Even a folder that a human accepted is only *read* if its configured/verified sharer is a Contact — so an accidental accept of a stranger's share still can't feed the agent.

**Why reads are tier-trust (not external).** The readable set is exactly "folders a human accepted from a known contact." A note there is the same trust as that contact's iMessage, which the tier already acts on directly. So `notes_read` runs **directly on the tier**, `SecretRedactor` as hygiene only. **Residual risk (stated):** trust is in the person, not the bytes — a trusted contact could paste a malicious payload; identical to the accepted risk of trusting their messages, not new exposure.

**Writes.** A tier creates notes in **its own accepted shared folder** (visible to that tier's people); `LeakGuard` blocks writing Cole's secrets into a shared folder.

---

## Supporting "a friend shares a note with Puddles"

This is the key scenario. Silent auto-accept is impossible (finding #8), but the newly-confirmed **pre-accept sharer lookup** (CKFetchShareMetadata + the invite email) makes a clean, spam-free design possible. Four paths, best→most-fragile:

| Path | How | Hands-off? | Fragility / cost | Verdict |
|---|---|---|---|---|
| **A. Shared folder per friend** | `puddles@` owns a folder, invites the friend; they accept once on their phone; notes they add flow in forever, contacts-trusted by construction. | ✅ after 1-time onboarding | none | **Chosen** — for the opted-in `friends`/`household` tiers |
| **B. Detect → contacts-filter → one-tap accept** | Puddles watches `puddles@`'s Gmail for invite emails, extracts sharer + link, checks Contacts (CKFetchShareMetadata / email name); for a **contact only**, sends one tap-to-accept approval (reuse plan 027 iMessage-approval). Human taps once; Puddles reads locally after. | ⚠️ one pre-vetted tap per ad-hoc note | none (no web scraping, no ToS issue) | **Chosen** — for ad-hoc one-off shares |
| **C. Browser-agent auto-accepts on iCloud.com** | Durable-login browser-agent (plan 023) opens contact-shared invite links, clicks "Join", reads via web. | ✅ zero taps | fragile: ~30-day 2FA re-trust, ~2h idle timeouts, anti-bot, **against Apple ToS** (account-flag risk) | **Optional** power-user upgrade; not the backbone |
| **D. UI-scripting auto-accept-all** | System Events clicks Accept on every incoming share; read-gate filters after. | ✅ | fragile macOS UI hack + share-spam surface | **Rejected** |

**Chosen design = A + B.** Known friends (the `friends` tier) get a shared folder → fully hands-off. Spontaneous shares from *any* contact are auto-detected, contacts-filtered, and reduced to a single pre-vetted tap. The pre-accept sharer lookup is what keeps B spam-free — Puddles only ever surfaces a real contact's share. C stays documented as an optional zero-tap upgrade for anyone willing to own the iCloud-web fragility.

**Escape hatches worth remembering:** if a note doesn't need *live collaboration*, the friend just **messaging** the content sidesteps all of this (Puddles already ingests iMessage/Gmail); and **shared Reminders lists** ride EventKit (clean, already integrated via `reminder-cli`) when the content is list-shaped rather than a rich note.

## Scoping — per-tier accepted folders (Plan 021 config factory)

`notes-cli` only operates on folders listed in the calling agent's `apple-pim/config.json` `notes` section; each entry carries the tier + sharer attestation:

```jsonc
// $WS/household/apple-pim/config.json
"notes": {
  "enabled": true,
  "folders": {
    "Household": { "tier": "household", "shared_by": "<partner-contact>", "write": true }
  }
}
// main config lists all accepted folders (main ⊇ all); friends lists its own.
```

- **CLI-level filter** (primary): only configured folders are enumerated/read/written.
- **Config-dir injection** (integrity): the calling agent's `configDir` is injected from identity (existing `apple-pim-scope` hook, extended to `notes_*`), so a tier can't widen scope via args.
- **Tool/sandbox layer** (Plan 022): `notes_read`/`notes_write` granted per tier.

---

## Architecture

```
tier/agent ── notes_read / notes_write ─► secure-apple-notes plugin (NEW; copy of secure-apple-calendar)
                                            ├─ read → contacts-verify + SecretRedactor ; write → LeakGuard
                                            └─ MCP bridge (reuse bridge-cache / mcp-bridge / wrap-tool)
                                                 ▼
                                            apple-pim MCP server (add `notes` tool)
                                                 ▼
                                            notes-cli (disclaim-wrapped)
                                              ├─ AppleScript → Notes.app : list/get/search/create/append (HTML→text)
                                              ├─ scope to configured folders only
                                              └─ optional: read ZSERVERSHAREDATA → sharer → ContactsTrustResolver
```

**Backend decision (researched):** AppleScript is primary for I/O (richest: HTML body, folders, create/append). SQLite (read-only) supplies the *optional* sharer identity. Shortcuts is the documented fallback if Automation-TCC/AppleScript proves unworkable (plain-text CRUD only, no sharing). Build `notes-cli` small; a community Notes MCP is a drop-in CRUD fallback but adds no gate.

**Tools:** `notes_read` (`list`,`get`,`search` — only configured folders, tagged with tier) · `notes_write` (`create`,`append`,`update` — into the tier's folder). `delete`/`move` deferred.

---

## TCC / permissions

`notes-cli` joins the disclaim wrapper (stable principal across node upgrades):
1. `install-disclaim-wrappers.sh` wraps it → `notes-cli.real`.
2. One-time GUI grants (via `launchctl asuser`, so the prompt lands in the GUI session): **Automation** ("control Notes") and, for the optional sharer read, **read access to the Notes Group Container / Full Disk Access**.
3. Verify `kTCCServiceAppleEvents` `auth_value=2` for `notes-cli.real`.

Automation TCC is stricter than EventKit and denied from SSH — the grant is a deliberate GUI step (same as the calendar CLIs). Confirm it holds when spawned via `node → disclaim-wrapper → notes-cli.real` (not just a shell).

---

## Operational setup (one-time, per shared folder)

Acceptance can't be automated (finding #8), so setup is a short one-time human ritual — done the low-friction way (**`puddles@` owns + invites out**, so nobody has to accept *on `puddles@`*):

1. Cole (on the mini GUI via Screen Sharing, or a `puddles@` device) **creates the tier folder** (`Household`/`Friends`) on `puddles@` and **invites** the partner/friend.
2. **They accept on their own device** (normal human flow). `puddles@` owns the folder — no acceptance needed on the `puddles@` side, ever.
3. Cole **adds one config line** mapping the folder → tier + sharer.
4. `notes-cli` picks it up; notes in that folder flow automatically forever after, gated on read.

**Fallback (share-*in*):** if instead someone shares a folder *into* `puddles@`, a human must accept it on `puddles@` each time (mini GUI / `puddles@` device) — reserve this for one-offs. Ad-hoc single-note shares likewise need a per-note accept, so steer recurring sharing to the owned folders above.

---

## Phasing

| Phase | Scope | Gate |
|---|---|---|
| **Phase 0 — small validation (needs 1 accepted folder)** | Cole shares a folder with `puddles@` from a contact and accepts it. Verify on the mini: (1) `notes-cli` reads it via **Automation TCC from the gateway chain**; (2) scoping to configured folders holds; (3) *optional* — can we parse `ZSERVERSHAREDATA` to the sharer's email/phone and match Contacts on this macOS version? | (1)+(2) pass ⇒ build. (3) decides auto-verify vs. config-attestation only — **either way the plan ships**, since the human accept carries security. |
| **Phase 1 — main** | `notes-cli` + `secure-apple-notes` + folder-config; read/write for **main** on Cole-shared folders. | main reads its configured folders at tier-trust. |
| **Phase 2 — household** | partner shares a `Household` folder; config maps it → household; read direct, write with `LeakGuard`. | household sees only its folder; non-configured folders invisible. |
| **Phase 3 — friends** | config-only: accept + map a `Friends` folder. | friends confined to its folder. |
| **Phase 4 — ad-hoc intake (path B)** | Detect invite emails to `puddles@` (secure-gmail), resolve sharer (CKFetchShareMetadata / email name), contacts-filter, and for a contact send a one-tap approval (plan 027); on approval the note is accepted + read at the sharer's tier. | Stranger invites are silently dropped; a contact's ad-hoc share reaches Cole as one pre-vetted approval and, once tapped, reads correctly. |

---

## Test plan (highlights)

- **Scope:** an agent can only enumerate/read/write folders in its config; a folder present in Notes but **not** configured is invisible to every tier.
- **Tier mapping:** a household-configured folder reads at household (+main), never friends.
- **Tier-trust (no worker):** a configured-folder note is read directly by the tier; `SecretRedactor` still redacts an API-key-shaped string.
- **Write leak-guard:** writing a secret-shaped string into a shared folder is blocked.
- **Auto-verify (if enabled):** `notes-cli`'s CKShare-derived sharer matches the configured `shared_by` Contact; on mismatch/parse-fail it falls back to config without erroring.
- **TCC durability:** after a simulated `node` upgrade, `notes-cli.real` still holds Automation (+FDA).

---

## Open questions — resolved / residual

| Question | Resolution |
|---|---|
| Can Puddles reach Cole's notes? | **No** — per-Apple-ID; use share-into-`puddles@` (this model). |
| Auto-appear or manual accept? | **Manual, mandatory** (Apple). |
| Can Puddles auto-accept (see → check contact → accept)? | **Not silently** (no programmatic accept; private container). **But it can pre-filter to contacts** (CKFetchShareMetadata + invite email give the sharer before accepting) ⇒ **path B**: auto-detect + contacts-filter + one-tap accept. Fully-hands-off requires the fragile iCloud-web path C. |
| Does `CKFetchShareMetadataOperation` work for a `com.apple.notes` share URL from a helper? | **Spike.** If yes → strongest sharer match (email/phone) for path B; if container-blocked → fall back to the invite email's sharer *name* (weaker fuzzy match to Contacts). |
| Get the sharer's identity for the gate? | **Not from AppleScript** (only `shared` bool). **From `ZSERVERSHAREDATA` CKShare blob** — works but fragile/obfuscation-prone ⇒ used as *optional* auto-verify; **config attestation is the robust primary.** |
| Shortcuts/App Intents backend? | CRUD-capable (plain-text), **no sharing** ⇒ fallback only; AppleScript primary. |
| Build vs reuse a Notes MCP? | Maintained MCPs do CRUD but **no sharing** ⇒ build small `notes-cli`; the gate is ours. |
| **Residual (Phase-0 only):** does the CKShare blob parse to a usable sharer email on this exact macOS? | The only thing left to check on a real share — and it only decides *auto-verify vs config-attestation*, not whether the feature ships. |

---

## What this reuses vs. builds new

| Reused as-is | Built new |
|---|---|
| `apple-pim` MCP server + disclaim wrapper + `install-disclaim-wrappers.sh` | `notes-cli` (AppleScript I/O + optional CKShare sharer read) |
| `secure-apple-calendar` scaffolding (`bridge-cache`/`mcp-bridge`/`wrap-tool`) | `secure-apple-notes` plugin (action-map + prefilter) |
| Plan 018 `ContactsTrustResolver` + Plan 022 contact→tier map | contacts auto-verify + folder→tier config |
| `mcp-hooks` (`SecretRedactor`, `LeakGuard`) | notes `action-map.ts` / `prefilter.ts` |
| Plan 021 per-agent config factory + `apple-pim-scope` hook | `notes` folder-config + hook tool-match extension |
