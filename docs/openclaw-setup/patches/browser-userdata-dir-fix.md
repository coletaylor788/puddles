# Persistent browser sandbox profile

OpenClaw 2026.9.6 still starts sandbox Chromium with a profile under the
container's temporary home. The retained patch lets the entrypoint read
`OPENCLAW_BROWSER_USER_DATA_DIR`. An unset or empty value keeps the upstream
`${HOME}/.chrome` default. A configured path can point at a host profile mounted
through the existing sandbox browser binds.

The entrypoint also removes `SingletonLock`, `SingletonCookie`, and
`SingletonSocket` from the selected profile before starting Chromium. These
files can survive an unclean container shutdown on a persistent mount and
prevent the next browser from starting. Cleanup belongs at container startup,
before this entrypoint launches Chromium. The profile must have one container
owner; it is not a way to share a running profile between browsers.

The patch changes only `scripts/sandbox-browser-entrypoint.sh`. Its
`FIX-BROWSER-USERDATA-DIR` and `FIX-BROWSER-SINGLETON-CLEAN` markers remain part
of the deployment contract. The managed deployment packages the patched
entrypoint with the browser image and recreates the browser sandbox through
`apply-and-deploy.sh`. The mounted profile remains outside the container.

The cumulative test in `packages/e2e/tests/candidate.browser-entrypoint.test.ts`
executes the candidate entrypoint with fake Xvfb, Chromium, and CDP probes. It
checks the configured profile argument and removal of all three stale files
without launching a real browser or touching a live profile. Run it through
the shared candidate lifecycle:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

The [durable browser design](../../plans/completed/023-durable-browser-agent-login.md)
describes the configuration that uses this seam. Rollback restores the previous
runtime and browser image through the managed deployment workflow. Removing
the patch itself returns Chromium to its temporary profile, so a mounted
profile would remain on disk but no longer be selected.
