---
name: openclaw-upgrades
description: "Upgrade a pinned OpenClaw release in Puddles. Use before planning or changing the OpenClaw version to audit upstream compatibility and maintained patches, refresh the browser image, and qualify the combined upgrade through safe-feature-development."
---

# OpenClaw upgrades

Use this sub-skill with
[safe-feature-development](../safe-feature-development/SKILL.md). It adds
upgrade-specific work to that lifecycle, not another deployment path. Reading
this skill does not authorize an upgrade or a new OpenClaw patch. Carry forward
the requester's existing approval and limits.

## Establish the target

Read the current [patch inventory](../../../docs/openclaw-setup/patches/README.md),
[application runner](../../../packages/e2e/README.md), and relevant component
documentation. Inspect any configured companion repository under its own
instructions; keep private patch details and configuration in private records.

Record the installed version, repository pin, proposed stable release, and exact
upstream commit. Check official release notes, documentation, and source for the
target rather than relying on current `main` or an older upgrade plan. Identify
changes to runtime prerequisites, plugin APIs, configuration, state migrations,
and the integrations this installation uses. Prefer native capabilities when
they replace our overrides while preserving required behavior.

Audit every maintained public and applicable private patch against that exact
target. Record a **remove**, **shrink**, or **retain** decision with upstream
evidence and the behavior that still needs regression coverage. A clean patch
application is not proof that the patch is still necessary or correct. Follow
the [patch policy](../../copilot-instructions.md#openclaw-extension-and-patch-policy)
for any changed or new patch; an upgrade approval does not authorize unspecified
patches. Preserve useful behavior tests when retiring a patch.

## Refresh the browser image

For installations using the managed Chromium container, include its refresh in
every OpenClaw upgrade. Updating OpenClaw, host Chrome, or Vercel agent-browser
alone does not update Chromium inside an existing image. Read the
[browser integration contract](../../../packages/agent-browser/README.md).

Use the target release's stock sandbox browser Dockerfile and entrypoint. Locate
them in that release rather than hardcoding a path or Debian version from an
older release. Upstream's [sandbox setup guide](https://docs.openclaw.ai/gateway/sandboxing/images-and-setup)
and `scripts/sandbox-browser-setup.sh` explain the build. The published
`openclaw:<version>-browser` Gateway image is a different product; do not silently
substitute it for the separate Chromium container or move the Gateway into it.

- Build before deployment, for the target Docker platform. Keep upstream browser
  behavior and the existing authenticated CDP relay and owner viewer contracts.
- Force the package-install layer to execute so `apt-get update` and Chromium
  installation use current packages. Use an appropriate cache bypass, such as
  `--no-cache`; rerunning a cached build or using `--pull` alone is insufficient.
  Respect the target recipe's pinned base digest. A pull does not advance that
  pin. The result is the Chromium version available from its package sources,
  not a promise of the latest Google Chrome version.
- Record the upstream recipe commit, resulting image ID/digest, platform, and
  actual Chromium version. Save the image under a separate candidate tag and
  bind the exact prebuilt artifact through the existing deployment controls.
  Do not build, install packages, or resolve a moving tag during cutover.
- Preserve the configured timezone, persistent profile, downloads, and host
  vault separation. Mount no vault, key, or Docker socket into the browser.
  Do not grant the browsing agent update or Docker administration tools.

If the installation does not use a managed browser container, record that this
step is not applicable. If the target's recipe changes its interface, resolve
compatibility before shipping; do not silently retain a stale image and call the
browser refreshed.

## Qualify and deliver together

Use the parent skill's focused checks and DEV, TEST, and PROD lifecycle. Qualify
the upgraded runtime and exact new image together. In disposable browser state,
check startup, authenticated CDP, the owner viewer, normal Vercel actions,
synthetic saved-login behavior, profile persistence after container recreation,
timezone, and absence of the vault from container mounts. Use the maintained
browser acceptance entrypoint and add focused checks for any uncovered changed
contract. Do not test by logging into real accounts or inspecting credentials.

Use [triggered CI](../../../packages/release/CI.md) for deployment. Include the
browser in the normal stopped-writer backup and recovery path. Preserve the prior
image and matching profile/state backup for rollback; downgrading an image alone
may not undo browser profile changes. Never restore a backup over new live writes.

Report the installed OpenClaw and Chromium versions, image identity, patch audit
outcome, and terminal release evidence. Distinguish source landing from runtime
deployment. This process couples browser refreshes to OpenClaw upgrades; it does
not create scheduled browser updates between releases.
