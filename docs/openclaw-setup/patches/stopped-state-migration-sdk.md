# Offline state migration through maintained SDK helpers

OpenClaw 2026.9.3 already has a readonly cron snapshot reader and a targeted
writer that checks the selected job's configuration revision. Its public SDK
exposes only the older mutating loader and whole-store writer. This patch
exports the existing narrow helpers instead of adding another storage path.
It also exposes existing include ownership and state database path helpers.

The config snapshot reader normally records config health in SQLite. A release
preflight must not do that. The patch forwards its existing optional `observe`
setting through the public reader. `observe: false` reads the source without
recording health. Existing callers retain their current default behavior.

The public native helper accepts a versioned manifest with checked config
leaves and, optionally, one job whose final and failure delivery must be
silenced. It uses the source writer and its locks, include guards, and compare
checks. It never loads the mutating cron API or replaces a whole cron store.
Job revision tokens come from the maintained storage codec, not a second hash
of a partly normalized job.

An older SQLite schema can prevent even a config write because the writer
records metadata. After the stopped-state snapshot, the helper calls the
already public schema-only repair operation. It then changes config before
ordinary doctor and checks the job's fresh revision afterward. The schema step
does not compile memory or start a gateway, scheduler, plugin hook, or model.
Private policy remains in the selected local manifest.

The patch targets stable source
`1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`. Its registered SDK tests use real
SQLite, including the maintained compressed 2026.7.1-2 fixture. They cover
readonly absent-state behavior, old-schema ordering, reviewed revision
preservation, conflicts, and concurrent unrelated jobs and runtime updates.
The accumulated pool also runs the public executor against the built SDK and
the offline installed artifact. It checks config ownership, retained secret
references and tilde paths, unchanged preflight state, and denied network
activity. Wrapper fixtures cover failures and interrupted rollback.

Apply this patch through the native runner. Remove exports only when the
upstream facade exposes equivalent maintained helpers. Do not substitute
distribution-file imports or direct SQLite writes in the release helper.
