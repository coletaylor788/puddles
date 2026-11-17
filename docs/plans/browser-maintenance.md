# Refresh Chromium and use the configured local timezone

Status: Production approved for browser refresh and Pacific timezone correction
Issue: https://github.com/coletaylor788/puddles/issues/364
Last updated: 2026-11-16

## Human section

### Design

The personal browser uses an old Chromium image and reports UTC. The host's
separate Chrome installation and timezone do not control that container.
Refresh the existing browser image from its supported Debian security packages
and configure the browser for `America/Los_Angeles`, including daylight saving.

```mermaid
graph LR
    A["Build replacement browser image"] --> B["Synthetic browser checks"]
    B --> C["Managed DEV and production release"]
    C --> D["Chromium with existing profile and Pacific timezone"]
```

Keep the current Vercel controller, Docker boundary, host vault and browser
profile. Use Docker's native `TZ` environment setting through the trusted launch
specification. Stop the old browser before applying new settings. Preserve the
previous image and configuration through the normal backup and rollback path.
No OpenClaw patch or upgrade is required.

Docker Desktop can briefly report a newly recreated profile directory as missing
even when it exists on the host. Retry that specific native launch failure up to
five times, 250 milliseconds apart, only while both mount sources are canonical
host directories. Keep strict bind mounts and existing container ownership checks.
Other errors still fail immediately; no Docker restart or broader mount is needed.

For ongoing updates, use trusted maintenance to rebuild, validate and deploy a
new image digest through the same release path. Do not grant the browsing agent
Docker access or make the live container self-modifying. A recurring schedule or
new update-request tool is a separate choice, not part of this repair.

### Status

**Approval:** Production approved.

**Approval reference:** The requester asked to update the outdated browser and
correct UTC to Pacific Time on 2026-11-16. This authorizes bounded maintenance of
the existing architecture. No recurring automation or new agent update permission
is included.

The replacement image contains Chromium 156.0.8078.79 and Pacific timezone data.
All 13 browser and plugin regressions and six migration checks pass. Managed
DEV validation and cleanup passed with the current CI toolchain. Production
qualification then stopped on slow archive fixture creation before transfer.
The reviewed fixture repair and all 312 package tests pass locally. The next DEV
run exposed an intermittent Docker directory-visibility failure before Chromium
started. Disposable mount probes reproduced it and recovered with a bounded retry.
The narrow launcher repair passed all 17 browser and plugin checks and retained
independent review. Fresh DEV and production validation remain. Production has
not changed.

## Agent section

### State

The running browser is Chromium 152.0.7977.82 on Debian 12 and UTC. The existing
image includes timezone data. The separate macOS Chrome is version 157 and the
host is already on Pacific Time. Private paths and exact image identities stay
in the companion configuration and local release records.

### Scope and acceptance criteria

- Refresh Chromium to the current supported Debian package in a replacement image.
- Verify the timezone in browser JavaScript and across container recreation.
- Check Pacific winter and summer offsets, not just the current clock display.
- Keep synthetic login, persistent profile, CDP authentication and vault isolation passing.
- Preserve real profile/vault data and existing agent permissions.
- Deploy through the existing managed lifecycle, without an OpenClaw patch.

### Architecture and decisions

Installed OpenClaw is 2026.9.6. Checked the later stable release v2026.11.4 and
current official sandbox image documentation. Image builds remain a separate
maintenance operation; updating OpenClaw or host Chrome does not refresh an
explicitly pinned browser image. The installed Vercel 0.43.0 CLI has no native
browser-update or timezone option in its help. Set the container's native `TZ`
in the existing launcher rather than adding a second controller or patching core.

Sources: [OpenClaw image maintenance](https://docs.openclaw.ai/gateway/sandboxing/images-and-setup),
[latest stable checked](https://github.com/openclaw/openclaw/releases/tag/v2026.11.4),
and [Debian arm64 Chromium](https://packages.debian.org/bookworm/arm64/chromium).
The Debian package page reports 156.0.8078.79-1~deb12u1. Record the actual built
version; do not assume macOS Chrome and Debian Chromium publish together.

### Implementation

Add optional validated IANA timezone configuration to the trusted browser launch
specification. Use `--env TZ=...` and include it in existing container ownership
checks. Keep omitted timezone behavior unchanged. Update the private image pin
and timezone, with explicit predecessor checks for the installed control file.

Retry `docker run` only for exit 125 with the exact missing-bind-source diagnostic
for the configured profile or downloads path (including Desktop's `/host_mnt`
prefix). Recheck both canonical host directories and existing container ownership
before retrying. Stop after five attempts. Keep `--mount`, the same image and
arguments, and the original native error on failure.

### Validation

Focused launcher tests cover timezone handling and malformed values. Installed
synthetic qualification checks JavaScript timezone and daylight saving offsets
before and after recreation, alongside existing login and isolation checks.
The replacement image reports Chromium 156.0.8078.79 and PST with offset -0800.
Its browser entrypoint is unchanged. The frozen paired dependency install is
restored. All 13 browser and plugin checks pass with the supported Node toolchain,
as do six migration checks including production preservation and whole-profile rollback.
Retained review and installed DEV passed, including timezone, synthetic login and
profile recreation. All 19 focused checks also pass on the current CI Node
toolchain. The refreshed candidate passed DEV and cleanup. Production qualification
stopped before transfer on archive fixture creation. The repaired fixture keeps
7,500 real archive members, the oversized listing, real extraction and content
checks, while reading its two input files once. Timeouts are unchanged. The
focused regression passed in 5.7 seconds and all 312 package tests passed with
the complete host PATH and required process inspection access. The repaired
candidate still requires DEV and the full production lifecycle.

The next DEV receipt failed in installed browser qualification and completed
teardown. Host metadata showed the canonical profile directory present while
Docker rejected its translated bind source. On Docker Desktop 4.70.0 with Engine
29.4.0, isolated read-only synthetic mounts reproduced the failure. In 20 directory
recreation cycles, six first attempts failed; all succeeded on the second attempt
after 250 milliseconds without changing the directory. These probes mounted no
real profile or credentials and required no Docker restart. Regressions cover
recovery for both mounts, bounded persistent failure, unrelated errors, genuinely
missing directories, symlink replacement and exact container ownership.
All 17 browser and plugin regressions passed, and the retained reviewer
independently passed the eight launcher tests with no actionable findings.

### Rollout and rollback

The existing lifecycle stops browser writers, backs up state, replaces the image
and configuration, validates production read-only, merges exact source and closes
cleanup. Require whole-profile backup coverage before production. Consolidate the existing
child entries into one profile-root entry during a reviewed idle controller
configuration cutover. Keep the existing backup untouched until normal CI replaces
it. A regression verifies rollback removes new root files and directories.
Preserve the old image/profile for rollback. Never mutate the running
container's package installation or inspect real authentication data.

### Review log

The retained browser reviewer found that individual profile-child backup entries
miss files introduced by a newer browser. Whole-root coverage is now required by
the maintenance control. The cutover must exclude concurrent CI admission, retain
the old configuration and restore services on failure. Installed proof remains
required.

Eligible cleanup restored the host reserve. The warm candidate registered and
passed DEV with complete cleanup. The locked backup configuration cutover now
covers the whole profile and preserves the existing backup until normal CI
replacement. Both controller services restarted successfully.

The first production submission stopped before the full suite or transfer because
its registered Node version differed from the current CI toolchain. No target
transaction or production deployment occurred, and source cleanup closed. Rebuild
with the configured toolchain and repeat affected DEV validation.

A narrow build-qualification prerequisite aligns the exact Node pin with current
CI while retaining the existing pnpm pin. Fourteen packaging and overlay tests
pass. This does not migrate the production Gateway interpreter. Historical
delivery commands are recovery-only; preserved recovery continues to use its
original immutable source, toolchain and artifacts. The current application
suite uses its maintained CI entrypoints, not the retired delivery route.

### Checklist

- [x] Diagnose the running browser and timezone.
- [x] Check later stable OpenClaw and supported image maintenance.
- [x] Prepare and verify the replacement image.
- [x] Review and test the configuration change.
- [ ] Pass DEV and production lifecycle.
- [ ] Verify exact merges, terminal receipts and eligible cleanup.
