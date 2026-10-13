# Deployment coordination

One release manager owns a FIFO lane from TEST through PROD and merge. DEV stays
open to feature owners under a short deployment lock. Building, focused tests,
and review do not reserve TEST or PROD.

## Feature owner

1. Work in one owned workspace and reuse its incremental build. Run focused tests
   and installed DEV checks. Keep the manager informed of readiness and blockers.
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

The [release package README](../release/README.md) defines commands, target
configuration, ticket fields, and direct backup replacement. Install tool updates
only between tickets after the independent tool suite passes. Application releases
use the installed version and do not rerun its implementation tests.

## Adoption checkpoint

The new controller is not installed yet. Before its first release, inspect legacy
slots, running deployment processes, and recovery references. Finish or explicitly
hand off legacy operations, disable legacy mutators including backup retention,
and configure one controller for the actual DEV, TEST, and PROD targets. Validate
its recovery in an isolated trial before switching live ownership. Keep any code
needed by outstanding recovery. Existing transactions follow
[legacy coordination](LEGACY_DEPLOYMENT_COORDINATION.md).
