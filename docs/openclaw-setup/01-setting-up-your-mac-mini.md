# Setting up your Mac Mini

This is the first guide in my journey building Puddles, my personal AI agent, on a Mac Mini. By the end of it you'll have a hardened, headless server you can manage from your phone or laptop — the foundation everything else gets built on top of.

Follow the [security architecture](security-architecture.md) throughout setup.
Bootstrap and recover at the physical console when Tailscale is unavailable.
Do not open a LAN management path to work around it.

The work here isn't strictly OpenClaw-specific. If you stop after this guide and never install an agent, you still end up with a securely run always-on home server you can use for anything. Worth doing on its own.

A few things you'll come away with:

- A Mac Mini that runs **without a monitor, keyboard, or mouse**
- **Two accounts** with clean separation: an admin you almost never log into, and a "service" account that runs everything
- An **encrypted disk** (FileVault), with physical access for recovery when Tailscale is unavailable
- **Key-authenticated SSH** over Tailscale; Touch ID is an optional key policy
- **Tailscale** for zero-config secure access from anywhere in the world
- Network isolation on its own VLAN
- **Automated weekly software updates** for installed packages
- **iCloud-backed runtime data** so a full Mac wipe never costs you anything you care about

Security is the throughline. A lot of the choices below go beyond the out-of-the-box Apple defaults — sometimes substantially — because the goal is defense in depth for a machine that'll eventually run autonomous agentic workflows on your behalf.

> **Time:** about half a day, mostly waiting on FileVault to encrypt and software to install.
> **Skill:** comfortable with home networking and firewall configuration.

---

## Table of contents

1. [Hardware](#1-hardware)
2. [Traditional Security Model](#2-traditional-security-model)
3. [What you need before starting](#3-what-you-need-before-starting)
4. [Initial macOS install and accounts](#4-initial-macos-install-and-accounts)
5. [Network: VLAN, ethernet, hostname](#5-network-vlan-ethernet-hostname)
6. [Sharing services and lock screen](#6-sharing-services-and-lock-screen)
7. [SSH keys](#7-ssh-keys)
8. [Tailscale](#8-tailscale)
9. [Homebrew and base tools](#9-homebrew-and-base-tools)
10. [FileVault and the two-step unlock model](#10-filevault-and-the-two-step-unlock-model)
11. [Recovery from your MacBook](#11-recovery-from-your-macbook)
12. [Recovery from your phone](#12-recovery-from-your-phone)
13. [Automated weekly Homebrew updates](#13-automated-weekly-homebrew-updates)
14. [iCloud backup convention](#14-icloud-backup-convention)
15. [Verifying everything works](#15-verifying-everything-works)
16. [Where to go next](#16-where-to-go-next)
17. [Appendix: gotchas worth re-reading](#17-appendix-gotchas-worth-re-reading)

---

## 1. Hardware

- **Mac Mini M4** (any Apple Silicon Mac will work; this guide is written for the M4 base model)
- Wired ethernet to your home router or switch

---

## 2. Traditional Security Model

### What I'm defending against

- **Physical theft** — encrypted disk, owner-credential-required recovery
- **Lateral movement from other devices on the home network** — VLAN isolation
- **Network attackers**: no management ports reachable outside Tailscale, including on the LAN
- **The agent itself getting compromised** (e.g. via prompt injection) — separate identity, standard user

### Compromises

- **Unattended recovery.** If FileVault prevents Tailscale from starting, someone must unlock the disk at the physical console.

### Key design choices and their reasons

| Choice                                              | Why                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Two accounts (admin + standard)                     | Compromise of the agent doesn't give attacker sudo. Admin has no personal data to exfiltrate.       |
| Admin has no Apple ID                               | Attack surface reduction — no iCloud, no Keychain sync, nothing personal on that account            |
| FileVault on                                        | Defense in depth on top of the always-on Apple Silicon hardware encryption                          |
| Tailscale                                           | Authenticated VPN access from anywhere without forwarding any ports                                 |
| Tailscale ACLs: agent CANNOT reach personal devices | Limits blast radius if the agent is compromised                                                     |
| Lock screen on, even though headless                | Background services run regardless of lock state; lock protects the physical box if anyone walks up |
| Puddle's files stored in iCloud                     | Free, automatic backup of `~/Documents` so a wipe is recoverable                                    |

### Logical Layout

Two principles drive everything inside the box:

- **Account isolation.** An admin account owns system-level changes (Homebrew, `sudo`, network/sharing toggles). A separate standard account (`puddles`) runs all the actual workloads — agent processes, background services, anything autonomous. The agent account **cannot `sudo`**. This limits account privileges; it does not replace agent sandboxing or prevent access to resources granted to that account.
- **Encryption at rest.** Disk is FileVault-encrypted to protect data against physical theft.

```
                    ┌─────────────────────────────┐
                    │   Mac Mini M4 (headless)    │
                    │  Encrypted disk (FileVault) │
                    │                             │
        Manage      │  cole (admin)               │
   ────────────────►│   - rarely logged in        │
                    │   - no Apple ID             │
                    │   - owns Homebrew           │
                    │                             │
    Daily use as    │  puddles (standard user)    │
    the agent ────► │   - has its own Apple ID    │
                    │   - runs all services       │
                    │   - cannot sudo             │
                    │                             │
                    │  System LaunchDaemons       │
                    │   - Tailscale (always on)   │
                    │   - brew autoupdate (Sun)   │
                    └─────────────────────────────┘
                                  │
                                  │  iCloud Drive
                                  ▼
                          puddles' Apple ID
                            (data backup)
```

### Network architecture

- Permit management only through Tailscale, with approved accounts and keys.
- Block access to server services from the internet, LAN, and other VLANs.
  VLAN isolation alone does not protect against devices on the same VLAN.
- Keep the server from initiating connections to personal devices.
- Use the physical console for bootstrap and recovery when Tailscale is unavailable.

See the [architecture diagram](security-architecture.md#host-and-network-architecture)
for the network and account boundaries.

---

## 3. What you need before starting

**On the Mac Mini:**

- A supported macOS release
- A monitor and keyboard for initial setup and recovery
- Wired ethernet

**On your other gear:**

- A MacBook authorized to manage the server over Tailscale
- An optional phone with an authorized Tailscale and SSH client
- A UniFi Dream Machine (or any router that supports VLANs — instructions are UDM-specific but adapt easily)
- A password manager you trust (this guide assumes Apple Passwords for the FileVault recovery key — anything works)

**A dedicated Apple ID ready:**

- One for **puddles** (the agent account) — we'll sign into iCloud with this. This is not the same as your own apple id.
- The admin (**cole**) intentionally does NOT use an Apple ID

**Names used throughout this guide** (substitute your own):

- Admin user: **cole**
- Service user: **puddles**
- Hostname: `<mac-mini>` — pick something short, lowercase, and memorable; the same name will become the device's tailnet name
- Tailnet name: `<mac-mini>`; SSH aliases must resolve to its Tailscale address
- VLAN for the Mini: I'll just call it **Agent VLAN** in this guide. Name it whatever you like in your UniFi controller.

---

## 4. Initial macOS install and accounts

1. Boot the Mac Mini, complete Apple's Setup Assistant.
2. **Don't sign into any Apple ID** when prompted. Skip it. (We'll sign puddles into iCloud later, in §14.)
3. Create the **first user as `cole`**, set as admin. Use a strong password
4. After reaching the desktop, open **System Settings → Users & Groups** and create a second user **`puddles`**, type **Standard** (not Administrator). Strong password.
5. Run software updates: **System Settings → General → Software Update**. Apply everything, reboot, repeat until clean.

**Why no Apple ID on cole:** keep personal iCloud data off the server. An admin
account can still have local Keychain entries; no iCloud sign-in does not mean
it has no secrets.

---

## 5. Network: VLAN, ethernet, hostname

### On the UniFi controller

1. Create a new isolated VLAN for the Mini (call it whatever you want; this guide refers to it as the **Agent VLAN**). Pick a subnet that doesn't overlap your other VLANs.
2. Add a **firewall rule**: traffic from the Agent VLAN → all other VLANs = **Drop**. (Default-deny outbound from the agent network.)
3. Block inbound connections from all other VLANs. Do not add a Trusted VLAN SSH exception or port forwarding.
4. Plug the Mini into the Agent VLAN and reserve its DHCP address for inventory.
5. Before enabling sharing services, configure host filtering to permit them only
   through Tailscale. Check same-VLAN access too; router rules cannot block that
   path. This guide does not supply deployment-specific host firewall rules.
   Keep services off until those restrictions are configured and verified.

### On the Mac Mini (logged in as cole)

```bash
# Set the hostname (otherwise it'll be something like "Mac-mini-2" with a random suffix).
# Pick something short, lowercase, and memorable. It becomes the tailnet name too.
HOST=mac-mini
sudo scutil --set HostName "$HOST"
sudo scutil --set LocalHostName "$HOST"
sudo scutil --set ComputerName "$HOST"
```

In **System Settings → Network**:

- Turn **WiFi off** entirely (click the WiFi entry → toggle off → also uncheck "Ask to join networks"). Ethernet only.

Use ethernet to avoid an additional network interface to configure and secure.

---

## 6. Sharing services and lock screen

After Tailscale and the network restrictions in §5 are ready, configure
**System Settings → General → Sharing**:

- **Screen Sharing**: enable only if needed, restricted to authorized users and Tailscale access
- **Remote Login** (SSH): set to "Only these users" → cole, puddles; require approved SSH keys
- ❌ Everything else (File Sharing, Media Sharing, Printer Sharing, Remote Management, Internet Sharing) — leave off

In **System Settings → Lock Screen**:

- Require password after screen saver: **Immediately**
- Start Screen Saver when inactive: 5 min
- Turn display off when inactive: 10 min
- Login window shows: **Name and password** (not the user list — minor hardening)

Yes, lock the screen even though no one's looking at it. Background services run regardless of lock state, and the lock protects the physical box if someone walks up.

In **System Settings → Energy**:

- Prevent automatic sleeping when display is off: **on**
- Start up automatically after power failure: **on**
- Wake for network access: **on** (enables Wake-on-LAN over ethernet)

---

## 7. SSH keys

Use approved keys for the account each developer needs. Keep key material out of
agent context and logs. Touch ID is optional, not an SSH requirement; choose a
key policy compatible with unattended development.

The following Secure Enclave example requires Touch ID on each use. Install the
public key at the physical console during bootstrap. Test it after §8.

On each Mac you want to SSH **from** (your MacBook, etc.):

```bash
# Create the Secure Enclave key (biometric required per use)
sc_auth create-ctk-identity -t bio -l 'Mac Mini SSH'

# Export the SSH key handle (NOT the private key — that stays in the Enclave forever)
ssh-keygen -K -w /usr/lib/ssh-keychain.dylib

# This drops two files in the cwd: id_ecdsa_sk_rk and id_ecdsa_sk_rk.pub
mkdir -p ~/.ssh
mv id_ecdsa_sk_rk* ~/.ssh/

# Tell SSH where the Secure Enclave provider lives (persist in zshrc)
echo 'export SSH_SK_PROVIDER=/usr/lib/ssh-keychain.dylib' >> ~/.zshrc
export SSH_SK_PROVIDER=/usr/lib/ssh-keychain.dylib
```

Copy `~/.ssh/id_ecdsa_sk_rk.pub` and on the **Mac Mini**, add it to **authorized accounts'** `~/.ssh/authorized_keys`:

```bash
# Run locally as each account that this key is authorized to access
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'sk-ecdsa-sha2-nistp256@openssh.com AAAA...your-pub-key...' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Test from your MacBook — Touch ID prompt should pop up:

```bash
ssh cole@<mac-mini>
ssh puddles@<mac-mini>
```

Use the Tailscale name or address, not a LAN hostname. Grant admin access only
when needed; standard-account access does not require an admin key grant.

---

## 8. Tailscale

Tailscale gives you encrypted access to the Mini from anywhere, no port forwarding, no DDNS.

### Install (as cole, at the physical console)

```bash
# Homebrew first — see §9 if you haven't done that yet, but it's fine to do this now
brew install tailscale

# Critical: use SUDO for brew services. Without sudo, it creates a per-user
# LaunchAgent that only runs when cole is logged in (i.e. never, on a headless server).
# WITH sudo, it creates a system LaunchDaemon that runs at boot.
sudo brew services start tailscale

# Bring up Tailscale. SSH uses macOS Remote Login and the keys from §7.
sudo tailscale up
```

Open the printed URL on your laptop, authenticate, and:

- **Tag the device** as `tag:agent`
- **Disable key expiry** for this device (default 180-day expiry will silently disconnect a server)

### ACL policy

In the Tailscale admin console:

- Allow authorized management devices to reach the server's SSH port (`22`).
- Allow Screen Sharing (`5900`) only if needed and only from authorized devices.
- Do not grant the server access to personal devices.
- Review existing grants too. A broader grant can defeat these restrictions.

Tailscale grants control tailnet access; they do not restrict the server's LAN
listeners. Verify both controls before treating remote setup as complete.

```bash
ssh puddles@<mac-mini>   # Tailscale name, approved key and account
```

---

## 9. Homebrew and base tools

As **cole** (admin), at the physical console during bootstrap or over Tailscale afterward:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

brew install node@22 git
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

> **Important:** Homebrew is **owned by whoever installed it.** `/opt/homebrew` ends up writable by cole and ONLY cole. Anything that runs `brew upgrade` later (including the autoupdate job in §13) MUST run as cole. The system LaunchDaemon in §13 handles that by running as the cole user.

---

## 10. FileVault and the two-step unlock model

### Enable FileVault

At the physical console, or through authorized Screen Sharing over Tailscale:

1. **System Settings → Privacy & Security → FileVault → Turn On**
2. When prompted, enable BOTH `cole` and `puddles` as FileVault users (both must be secure-token holders).
3. **Recovery key:** store it in your password manager.
4. Wait for encryption to finish (can take an hour or more on first run).

Verify both users are enabled:
```bash
sudo fdesetup list
# Should show both cole and puddles
```

### After a reboot

1. Unlock FileVault at the physical console if Tailscale is unavailable.
2. Log into the service account's GUI session so its LaunchAgents and Messages
   can start. Use the console, or authorized Screen Sharing after Tailscale is up.
3. Confirm the expected services are running before leaving the machine unattended.

Keep FileVault enabled. A UPS can reduce unexpected restarts, but does not replace
an available recovery method.

---

## 11. Recovery from your MacBook

Once Tailscale is available, connect using the approved key and tailnet name.
If it is unavailable, use physical recovery from §10. Do not fall back to LAN
SSH or direct VNC. The legacy `scripts/mac-mini/unlock.sh` LAN recovery flow is
not part of this architecture; do not use it as a setup step.

---

## 12. Recovery from your phone

Use an authorized Tailscale client and SSH key after the server is reachable.
A phone connection cannot replace physical FileVault recovery when the server's
Tailscale service has not started. Any alternate recovery design needs explicit
human approval under the security architecture.

---

## 13. Automated weekly Homebrew updates

Tailscale's Homebrew install can't auto-update itself, and you don't want to be SSHing in to run `brew upgrade` by hand every week. This repo ships a system LaunchDaemon that does it for you.

### What's in the repo

- `scripts/mac-mini/brew-autoupdate.sh` — runs `brew update && brew upgrade && brew cleanup`, logging to `~/Library/Logs/brew-autoupdate.log`
- `scripts/mac-mini/com.cole.brew-autoupdate.plist` — system LaunchDaemon, fires Sundays at 03:00 local
- `scripts/mac-mini/install-brew-autoupdate.sh` — installs both with the right perms

### Install (as cole, on the Mini)

```bash
cd ~/git/puddles
sudo ./scripts/mac-mini/install-brew-autoupdate.sh
```

### Validate

```bash
# Trigger immediately to confirm it works
sudo launchctl kickstart -k system/com.cole.brew-autoupdate
sleep 60
tail ~/Library/Logs/brew-autoupdate.log
# Expect to see "=== done @ ... ===" with a freed-disk-space line
```


---

## 14. iCloud backup convention

I accept that the entire OS install can be lost — but I want to never lose data that can't be reproduced from code or APIs.

### The convention

Apply this to every component you install going forward:

| Path                       | Contents              | Backed up by      |
|----------------------------|-----------------------|-------------------|
| `~/git/<project>/`         | Code, install         | GitHub            |
| `~/Documents/<project>/`   | Runtime data, configs | iCloud Drive      |

Most modern tools support `--data-dir`, `XDG_DATA_HOME`, or an env var to redirect their data location. When you install something, point its data dir at `~/Documents/<project>/`. If a tool insists on `~/.thing/`, symlink: `ln -s ~/Documents/thing ~/.thing`.

### Sign puddles into iCloud

Use the service account's GUI session, locally or through authorized Screen
Sharing over Tailscale. Never sign a personal iCloud account into this server.

In **System Settings**:

1. Click **"Sign in with your Apple ID"** at the top of the sidebar → enter puddles' Apple ID + password → 2FA code from your phone.
2. **Apple Account → iCloud → "Saved to iCloud"** — toggle ON:
   - ✅ **iCloud Drive** → click ⓘ → toggle ON **"Desktop & Documents Folders"**
   - ✅ **Contacts**
   - ✅ **Calendars**
   - ✅ **Reminders**
   - ✅ **Notes**
   - ✅ **Messages in iCloud**
   - ✅ **Keychain**
   - ✅ **Find My Mac** (lets you locate/wipe if stolen)
   - ✅ **Photos** (only if you'll save anything to Photos)
   - ✅ **Mail** (only if using Mail.app)
   - ✅ **Safari** (optional)
3. **"Saved to this Mac" section** at the bottom: leave everything OFF — we want all of it in iCloud.
4. **iCloud Drive → ⓘ → "Optimize Mac Storage"** — toggle **OFF**.

**Why turn off Optimize Mac Storage:** when ON, macOS evicts the actual file contents and leaves tiny `.icloud` placeholder stubs in their place. Containers (and any non-Finder process) reading those paths get the stub, not the file. Turning it off keeps every iCloud Drive file fully present on disk so the agent containers can read `~/Documents/puddles/soul.md` and friends without surprises. Check available disk space before enabling additional synced data.

After flipping these, give it a few minutes. `~/Documents` and `~/Desktop` get moved into the iCloud container automatically. Verify:

```bash
ls -la ~/Documents
# Should show a path under ~/Library/Mobile Documents/com~apple~CloudDocs/Documents
```

That's it. From here on, any project that lives at `~/Documents/<project>/` is automatically backed up.

---

## 15. Verifying everything works

Run through this checklist. Every line should pass.

```bash
# From your MacBook over Tailscale (or your phone, anywhere in the world)
ssh puddles@<mac-mini> 'whoami'
# → puddles (Touch ID only if the chosen key requires it)

# From the Mini, as cole
sudo fdesetup list
# → both cole and puddles listed (FileVault enabled for both)

sudo launchctl list | grep tailscale
# → tailscale daemon present, exit status 0

sudo launchctl list | grep brew-autoupdate
# → com.cole.brew-autoupdate present

ls -la /Users/puddles/Documents
# → path under Mobile Documents (iCloud)

# From puddles via VNC, in System Settings → Apple Account → iCloud
# → Drive ON, Desktop & Documents ON, Messages in iCloud ON, Optimize Mac Storage OFF
```

Also confirm SSH and Screen Sharing are unreachable outside Tailscale, including
from the same LAN. An unauthorized tailnet device must not reach them either.

Before relying on unattended operation, rehearse a reboot with someone at the
physical console. Confirm FileVault recovery, Tailscale access, and the service
account's GUI session. Schedule this around any running workloads.

---

## 16. Where to go next

With the access restrictions and recovery checks complete, the Mini is ready for
headless operation. From here:

- **Stop here** if you just wanted a home server. It's already useful — you can run any service that fits on macOS.
- **Continue to guide 02** to install OpenClaw and connect your first integrations.

The next guide (when written) assumes the state you have right now: two accounts, FileVault on with both users enabled, Tailscale up, and iCloud Drive backing up `~/Documents`.

---

## 17. Appendix: gotchas worth re-reading

These are all the obstacles I hit getting a secure Mac server running, here's to hoping you don't have to.

- Per-user LaunchAgents need a GUI login, not just an SSH session.
- Start Tailscale as a system service so it does not depend on an admin GUI login.
- Homebrew updates must run as the account that owns its installation.
- Never paste passwords or SSH key material into agent sessions.
- Keep recovery credentials available to the human performing physical recovery.
