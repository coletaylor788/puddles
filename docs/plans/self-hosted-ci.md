# Run CI on owned Macs

## Human

### Status

**Approval:** Production approved for CI configuration and runner setup.
**Approval reference:** The requester asked to align every remaining dependency
with owned Mac compute and GitHub orchestration. Earlier guidance also requested
removing duplicate application checks and retaining separate tooling checks.

### Design

Public repository workflows still selected hosted macOS and Linux machines even
though the deployment pipeline already used owned Macs. Register a separate
public runner on the development Mac and select it explicitly for tooling and
CodeQL. Repository-level runner registrations cannot be shared across repositories.
Keep the existing deployment runners and queue unchanged.

Retire the duplicate application workflow. Application builds, full-suite checks
and installed acceptance remain in their normal incremental build and deployment
pipeline. Keep tooling tests scoped to tooling changes and retain all three CodeQL
languages and scheduled scans. Offline Macs cause queued jobs, never hosted fallback.

Use separate runner work, temporary and tool-cache paths. The tooling job removes
its generated output and temporary package manager. CodeQL uses the runner's
job-temporary storage. Public forks require GitHub maintainer approval before
execution, configured before enabling the new runner; same-repository job guards
provide an additional check. No application or upstream patch changes are needed.

## Agent

- Change `.github/workflows/release.yml` and `codeql.yml` to explicit self-hosted
  labels. Retire `integration.yml` and its workflow-only assertions.
- Preserve cumulative patch registration tests and actual application test entrypoints.
- Validate parsed workflow selection, scope, coverage, fork conditions and cleanup.
- Independently review and validate real jobs on the registered development runner.
- Coordinate main refresh with active feature owners before they submit new candidates.
- Verify final job runner identity and bounded generated output after landing.

GitHub documents repository runner scope in
[Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)
and the Apple Silicon prerequisites in
[CodeQL CLI setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-the-command-line/set-up-codeql-cli).
