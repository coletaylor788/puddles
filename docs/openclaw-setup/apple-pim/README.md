# Durable TCC for the Apple-PIM Swift CLIs

Keeps Reminders / Contacts / Calendar working through Homebrew `node` upgrades.

## The problem

The [Apple-PIM-Agent-Plugin](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)
ships small Swift CLIs (`reminder-cli`, `contacts-cli`, `calendar-cli`,
`mail-cli`) that are the real EventKit / Contacts clients. They're spawned by
**node** — either the OpenClaw gateway (the `apple-pim-cli` plugin, and the
`secure-apple-calendar` ContactsEgressGuard) or the apple-pim MCP server.

macOS attributes a spawned CLI's TCC permission to its **responsible process**,
which for a short-lived child of node collapses to **node itself**. Homebrew's
node is *ad-hoc signed*, so its binary identity changes on every
`brew upgrade node@22`. The moment node's path/signature changes, the TCC grants
macOS recorded against the old node binary are gone, and every PIM call fails:

```
Reminders → EKCADErrorDomain Code=1015  "XPC error communicating with calaccessd"
Contacts  → CNErrorDomain  Code=100     "Access Denied"
```

Pinning node would stop the breakage but also stop security updates — not what we
want.

## The fix

Move the TCC principal off the ever-changing node binary onto the **stable Swift
CLIs**. A tiny native launcher (`pim-disclaim.c`) is interposed in front of each
CLI; it re-spawns the real binary with macOS *responsibility disclaimed*
(`responsibility_spawnattrs_setdisclaim` — the same SPI terminal emulators use so
child shells get their own TCC identity). The real CLI then becomes **its own TCC
principal**: a stable path + signature, independent of whichever node invoked it.

```
node → reminder-cli (launcher, responsible = node)
         → [disclaim] reminder-cli.real (responsible = itself)  ← TCC principal
```

Grant once; it survives every future node upgrade.

### Why wrap inside `.build/release`

All three spawn sites resolve the CLIs to the same place — the plugin's
`swift/.build/release/<name>-cli`:

- `apple-pim-cli` plugin → `~/.local/bin/<cli>` (a symlink into `.build/release`),
- the MCP server's `findSwiftBinDir()` prefers `.build/release` over `~/.local/bin`
  (first dir containing `calendar-cli` wins; no override knob),
- the ContactsEgressGuard → `contacts-cli` (resolves to the same).

Wrapping at that single resolved location fixes all three at once — with **no
config overrides, no upstream-repo fork, and no change to the secure plugin's
tool surface**. The launcher is self-locating (no baked paths): it finds its own
directory and execs the sibling `<name>.real`.

## Files

| File | Purpose |
|---|---|
| `pim-disclaim.c` | The self-locating disclaim launcher (compiles to a per-CLI wrapper). |
| `install-disclaim-wrappers.sh` | Idempotent installer: builds the launcher, renames `<cli>` → `<cli>.real`, drops the launcher as `<cli>`, refreshes `~/.local/bin` symlinks. |

## Install

On the mini (CLIs must already be built — `cd ~/git/Apple-PIM-Agent-Plugin/swift && swift build -c release`):

```bash
./install-disclaim-wrappers.sh           # defaults to ~/git/Apple-PIM-Agent-Plugin
# or: ./install-disclaim-wrappers.sh /path/to/Apple-PIM-Agent-Plugin
```

The installer is safe to re-run. It detects already-wrapped CLIs (via an embedded
marker) and only refreshes the launcher rather than double-wrapping.

## Grant TCC (one time, needs the GUI session)

TCC consent **cannot** be set over SSH — the prompt has to appear in the user's
Aqua (GUI) session, and a call made from an SSH/Background context is silently
denied (and can cache a denial). Run each trigger via `launchctl asuser` so it
lands in the GUI session, and click **Allow** on the mini (directly or via Screen
Sharing):

```bash
launchctl asuser "$(id -u)" ~/.local/bin/reminder-cli lists
launchctl asuser "$(id -u)" ~/.local/bin/contacts-cli list
launchctl asuser "$(id -u)" ~/.local/bin/calendar-cli list
# mail-cli only if you use the mail tool
```

Each grant attaches to the stable `<cli>.real` binary. Verify:

```bash
sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" \
  "select service,client,auth_value from access \
   where client like '%/.build/%release/%-cli.real';"
# expect auth_value = 2 (allowed) for Reminders/AddressBook/Calendar
```

Then bounce the apple-pim MCP server (the gateway respawns it) so any cached
transport reconnects, and confirm end-to-end (e.g. ask the agent to list
reminders).

## After a plugin rebuild

A deliberate `swift build` regenerates `.build/release/<name>-cli` (overwriting
the launcher and removing the `.real` file) and changes the CLIs' code hash. So
after rebuilding the plugin:

1. Re-run `install-disclaim-wrappers.sh` (re-wraps).
2. Re-grant once (the rebuilt `.real` binaries have new code hashes).

This is infrequent (only when you update the Apple-PIM plugin itself). node
upgrades — the common case — never require any of this.

## Optional future hardening: rebuild-stable grants

The Swift CLIs are ad-hoc/linker-signed, so their TCC grant is pinned to the
binary's code-directory hash, which changes on every rebuild. Signing the
`<cli>.real` binaries with a stable self-signed certificate (giving them an
identifier-based designated requirement) would let grants survive rebuilds too.
Deferred because it needs a code-signing certificate created in a GUI keychain
(the login keychain isn't reachable over SSH), and it's beyond the node-upgrade
durability this fix targets.
