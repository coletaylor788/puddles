# Sandbox document and media tools

Status: Approved for implementation and production
Issue: https://github.com/coletaylor788/puddles/issues/310
Last updated: 2026-10-15

## Human section

### Design

Upgrade the agent sandbox with complete PDF, image, and audio/video processing capabilities.

| Change | What it delivers | Why |
|---|---|---|
| **Install a pinned Node runtime and TypeScript runner** | Run JavaScript and TypeScript scripts inside the sandbox. | Required by these libraries and lets agents combine operations into reusable scripts. |
| **Add `clawpdf`** | Extract PDF text, inspect metadata, select pages, and render pages to PNG through its existing CLI. | Supports document inspection and prepares scanned pages for visual analysis. |
| **Add `rastermill`** | Inspect, resize, convert, and compress images, with codec support for HEIC/HEIF and AVIF. | Handles screenshots, attachments, phone photos, thumbnails, and images prepared for model input. |
| **Add `ffmpeg-wasm`** | Inspect media, extract audio, create thumbnails, trim clips, resample audio, and convert supported formats. | Provides local audio and video processing. Includes building and packaging its required WASM assets. |
| **Provide commands and script imports** | Expose existing PDF/media CLIs, add a small image command, and make libraries importable from workspace scripts. | Makes the installed capabilities directly usable by agents. |
| **Update sandbox guidance** | Document available commands, supported formats, examples, output locations, and error handling. | Helps agents use the tools correctly without improvising installations. |
| **Package, validate, and deploy the complete image** | Pin dependencies, test actual file-processing tasks and failure cases, and release through DEV, TEST, and production with rollback. | Makes the capabilities reproducible and available after container recreation. |

### Status

**Approval:** Production approved. **Approval reference:** The requester said “author as a proposal, then approved to implement and ship” on 2026-10-15, approving the table above. Scope includes implementation, validation, deployment, merge, and cleanup.

Implementation and local installed acceptance are complete. Independent review is clear. DEV, TEST, and production promotion remain with the release manager.

## Agent section

### State

Owned branch: `codex/sandbox-media-tools`. The initial live inventory found no Node or npm on the two running agent sandbox PATHs. The installed host OpenClaw runtime includes clawpdf 0.3.2 and rastermill 0.3.3; these are not sandbox imports. No production changes have been made.

### Scope and acceptance criteria

Deliver every row in the approved table. Prove PDF extraction/rendering, image inspection/conversion/resizing including phone formats, audio extraction/resampling, media probing/thumbnails/trimming, TypeScript execution, workspace imports, explicit failures, and operation after container recreation. Retain existing sandbox filesystem, network, identity, and credential boundaries.

### Architecture and decisions

Use the existing Docker agent sandbox and native OpenClaw lifecycle. Add an immutable tool installation to the image, retain the non-root sandbox user, and keep writable agent workspaces separate. Reuse upstream CLIs; add only the image interface and module resolution needed for workspace scripts. Build FFmpeg WASM before deployment and package the compiled output. Pin dependency and upstream build inputs. Do not expose the host OpenClaw installation to containers.

### Implementation

Add maintained image/build inputs, package lock, image command, script runner, and agent guidance under a dedicated sandbox tools component. Connect the prepared image to the application release callbacks and environment bindings using existing release interfaces. The configured companion application builder uses the public component to package a Docker archive, its immutable image ID and SHA-256, installed acceptance, and bundled guidance. The configured full application test runner loads and tests that image. Public Linux CI separately builds, exports, loads, and tests it; the generic macOS application path does not require Docker. Environment callbacks use native configuration writes and target-scoped recreation. A stable application stop callback removes normal sandbox containers after services stop, including during rollback.

### Validation

Use synthetic local files and actual installed libraries. Cover malformed and unsupported files, failed child commands, resource limits, usable outputs, and module imports outside the installation directory. Run focused component checks, installed DEV checks, independent full-diff review, the full application suite, and installed TEST checks on the frozen output. Production checks remain bounded and read-only with no message delivery.

### Rollout and rollback

Promote the same prepared image through DEV, TEST, and production using the installed controller and existing application callbacks. Record the previous image identity and retain it for rollback. Stop services and retire target normal containers before restoring configuration and state; recreate with the prior image on the next use. Browser containers keep their separate lifecycle. Recreate affected containers while preserving their mounted workspace data. No builds or downloads occur during production activation.

### Review log

The retained reviewer verified focused tests and native lifecycle acceptance. Review found a rollback container cleanup gap and a Docker dependency in generic macOS CI; both were corrected. The retained reviewer cleared the complete corrected diff and manager callback bindings. Focused checks passed: 3 public media tests, 20 companion tests, and actual installed media and native rollback acceptance.

### Checklist

- [x] Record the approved proposal and production authorization.
- [x] Implement all approved capabilities and durable regressions.
- [ ] Validate installed DEV behavior and complete independent review.
- [ ] Pass full application and TEST validation on the frozen output.
- [ ] Deploy, verify production, merge, and finalize owned workspaces.
