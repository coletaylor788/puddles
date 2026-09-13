# Offline state migration through maintained SDK helpers

OpenClaw 2026.9.3 already has a readonly cron snapshot reader and a targeted
writer that checks the selected job's configuration revision. Its public SDK
exposes only the older mutating loader and whole-store writer. This patch
exports the existing narrow helpers instead of adding another storage path.
It also exposes existing include ownership and state database path helpers.

The config snapshot reader normally records config health in SQLite. A release
preflight must not do that. The patch forwards its existing optional `observe`
settings through the public reader. `observe: false` disables health recording.
Preflight also selects `pluginValidation: "core-only"` to avoid reading the
installed plugin index. Full plugin validation remains in the stopped config
write. Cron partition resolution can request the existing
`artifactPreservingReadOnly` path, which inspects a private SQLite snapshot
instead of creating WAL or SHM files beside an older database. Existing callers
retain their current default behavior.

The public native helper accepts a versioned manifest with checked config
leaves and, optionally, one job whose final and failure delivery must be
silenced. It uses the source writer and its locks, include guards, and compare
checks. It never loads the mutating cron API or replaces a whole cron store.
Job revision tokens come from the maintained storage codec, not a second hash
of a partly normalized job.

An older SQLite schema can prevent even a config write because the writer
records metadata. Legacy config can also fail current validation before a
selected write runs. After the stopped-state snapshot, the helper repairs the
schema, previews the maintained legacy config migrations, and binds the
migration semantics, cron partition paths, and selected job revision to
preflight evidence. The stopped phase reads fresh cron row fingerprints and
the complete effective job set, then uses those values for its atomic copy.
Normal job runtime updates during pre-downtime staging therefore do not force
rollback after shutdown. It copies the complete
effective job set from a retired `cron.store` partition to the post-migration
partition before persisting the normalized config. Both partitions have
compare-and-swap fingerprints. The selected job revision and the semantic job
set must remain unchanged.

The stopped config repair calls the same migration, plugin validation, include
ownership, metadata stamping, and config writer used by doctor. It rejects
partial validation instead of persisting a half-migrated file. It also
canonicalizes a legacy markerless multi-agent roster and stamps explicit
ownership before private compare-and-swap writes. It does not select a default
agent or grant access to an unowned surface. Private selected
config writes run next, followed by ordinary doctor and the revision-bound cron
write. None of the bounded pre-doctor steps compile memory or start a gateway,
scheduler, plugin hook, or model. Private policy remains in the selected local
manifest.

The patch targets stable source
`1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`. Its registered SDK tests use real
SQLite, including the maintained compressed 2026.7.1-2 fixture. They cover
readonly absent-state behavior, old-schema ordering, legacy config repair,
markerless multi-agent ownership, cron partition migration, reviewed revision
preservation, conflicts, and concurrent unrelated config, job, and runtime
updates.
The accumulated pool also runs the public executor against the built SDK and
the offline installed artifact. It checks config ownership, retained secret
references and tilde paths, unchanged preflight state, and denied network
activity. Wrapper fixtures cover failures and interrupted rollback.

Apply this patch through the native runner. Remove exports only when the
upstream facade exposes equivalent maintained helpers. Do not substitute
distribution-file imports or direct SQLite writes in the release helper.
