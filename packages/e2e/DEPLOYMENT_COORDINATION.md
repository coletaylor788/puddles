# Deployment coordination

## Triggered CI cutover

[Plan 064](../../docs/plans/064-triggered-ci.md) replaces the manager with
[GitHub workflows and a supervised host transaction](../release/CI.md).
Feature agents remain paused until its live dummy trial passes. Do not start a
release-manager heartbeat or submit new legacy tickets. Build and refresh from
main before queueing; DEV CI deploys, checks installed behavior, and tears down.
Production CI runs the full suite and TEST/backup/PROD/merge sequence. Scripts
own queuing, recovery, cleanup, and status delivery. A stale candidate returns
to its owner; no rebase or repair occurs while it holds a deployment lane.

The remaining text describes the prior controller adoption and retained recovery.
It does not authorize restarting the retired manager.

## Previous process

One release manager owns a FIFO lane from TEST through PROD and merge. DEV stays
open to feature owners under a short deployment lock. Building, focused tests,
and review do not reserve TEST or PROD.

## Feature owner

1. Work in one owned workspace and reuse its incremental build. Run focused tests
   and installed DEV checks using the same preparation, startup, health, and feature
   acceptance path as TEST. Keep the manager informed of readiness and blockers.
2. Commit and review the feature, satisfy repository checks, then call the installed
   controller's `enqueue CONFIG TICKET`. Paired repositories use one ticket.
3. At the front, rebase main and rebuild changed inputs. Run the full application
   suite, deploy the same frozen output to TEST and run its acceptance tests.
4. The controller replaces the one backup, deploys to PROD, runs read-only tests,
   and merges the tested heads. Stay engaged through fixes and cleanup.
5. Publish source, then run `finalize` from outside the workspace.

If the feature fails, the controller recovers before releasing its ticket. Repair
in DEV and rejoin the back. A failed final merge holds the ticket and intake until
merge succeeds or production is restored. Never restore over new live writes.
Cleanup failures are retried independently and do not reserve the release lane.

## Manager

Read `status CONFIG`; call `run CONFIG` to finish or recover the active ticket, or
take the oldest ready feature. Run again for the next ticket. Do not edit queue
JSON or delete lock files. SQLite releases the controller lock when its process
exits. A supervisor recovers a crashed worker; the manager investigates unresolved
recovery before proceeding.

Use the [release-manager skill](../../.github/skills/release-manager/SKILL.md) for
owner updates and the hourly native wake-up. A timer does not grant permission,
replace a live owner, or make a failed deployment successful.

Before admission, confirm the owner exercised the changed behavior in deployed
DEV and reconciled configuration differences. Keep that result in the conversation.
A focused probe or passing unit suite alone is not DEV readiness. For each late
failure, fix the missing DEV coverage or shared deployment path before another attempt.

The [release package README](../release/README.md) defines commands, target
configuration, ticket fields, and direct backup replacement. Install tool updates
only between tickets after the independent tool suite passes. Application releases
use the installed version and do not rerun its implementation tests.

## Adoption checkpoint

The trial completed through PROD, source merge, and normal intake. The installed
controller now owns new releases and direct backup replacement. Stable service
commands replace the trial callbacks; legacy automatic backup retention is disabled.

Keep any code still needed by outstanding recovery until its consumers are retired.
Cleanup is independent of the ready queue. Inspect slots, running processes, and
recovery references before removing old resources. Existing transactions follow
[legacy coordination](LEGACY_DEPLOYMENT_COORDINATION.md).
