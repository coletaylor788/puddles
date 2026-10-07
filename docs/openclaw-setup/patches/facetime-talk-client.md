# FaceTime as a shared Talk client

This patch targets OpenClaw 2026.9.6 after `talk-agent-parity.patch`.
FaceTime supplies call admission and audio while the Gateway owns the same
conversation and agent behavior used by native Talk.

## Shared session

Set `plugins.entries.facetime.config.realtime.mode` to `talk`. Configure the
allowlisted owner and canonical session as usual. Provider, model, voice,
instructions, reasoning, tools, and authorization come from native Talk.
Independent provider, voice, instruction, and tool-policy overrides are rejected
in shared mode. Shared Talk accepts inbound calls only: outbound tool discovery and dialing are blocked, and retained standalone dials are cancelled instead of adopted. Normalized Talk configuration can be parsed repeatedly without introducing standalone defaults. Existing standalone installations keep their current behavior.

The scoped `runtime.realtimeVoice.createSession` API binds an authenticated call
to the existing Talk runners, session history, transcript writer, and task
controls. Registry retirement, Gateway retirement, and call closure prevent new
admission. The bridge retains steering and completion-ownership methods instead
of reducing the native runner to a plain callback.

## Call lifetime

A normal hangup stops audio and detaches accepted work so it can finish in the
canonical conversation. Task cancellation remains a separate native control.
Explicit phrases such as “hang up” or “end this call” request the carrier's
physical hangup; quoted, conditional, and negated phrases do not. Transport
closure fences stale audio and new work while preserving final transcript flush.

Provider teardown begins as soon as the carrier is revoked. Native audio suspension
runs concurrently with shared session cleanup so persistence cannot keep playback
running. Process-output suppression remains until physical hangup is confirmed.

## Incoming audio startup

The native companion needs an answered call before normal capture can find its
active audio owner. The adapter answers with a verified muted uplink, starts
capture, then waits for provider and route readiness before unmuting. Active
call events cannot bypass the outstanding answer acknowledgement. Startup
failure hangs up the carrier and verifies closure.

Before process-output suppression starts, caller audio can reach the host
speaker. Set host output volume to zero when local playback is unwanted. This host
setting is separate from the microphone readiness gate and must be retained
across output-device changes.

## Automatic helper recovery

The helper supervisor starts the call apps and reconnects after app or Gateway
exit. The injector owns a single timeout process and joins it when attachment
finishes. Successful, failed, timed-out, and interrupted attempts release their
output pipes and temporary authentication files before the next attempt.

## Packaging and validation

FaceTime is distributed separately from the OpenClaw package. Install or bundle
the patched FaceTime source package with this host runtime. Installing the
unmodified published plugin will not select this shared session path.

The cumulative manifest covers the carrier's existing admission, audio,
packaging, helper, lifecycle, and driver regressions, plus native session,
runtime authority, runner properties, and initial-history propagation. Tests use
synthetic providers and native helper fixtures. Physical account routing,
helper/driver readiness, bidirectional audio, latency, and interruption still
require target-host acceptance before enabling the carrier.

The separate [native companion patches](facetime-native/README.md) cover shared
answer acknowledgement and carrier closure. Puddles owns their pinned source and
compiled regressions; native packaging and device acceptance remain separate.

## Rollout and rollback

Stage the plugin disabled and owner-only. Inherit later fixes through the native
Talk owners. Use the maintained artifact pipeline for installation and rollback;
restore the matching runtime and configuration together. Native helper changes
have their own tracked rollback and must preserve pre-existing host settings.

## Shared Talk readiness

FaceTime preflight and call creation use the same host provider resolver in Talk mode.
The check inherits Talk model precedence and rejects unsupported carrier routing
without opening a voice session. Standalone FaceTime provider settings remain separate.

## Durable audio permission identity

Setup copies the unchanged, verified Developer ID capture helper to a stable
per-user FaceTime audio directory. A narrow native launcher gives that helper
responsibility for macOS audio consent, independently of Node. Process replacement
preserves the PID, standard streams, and existing call-cleanup behavior. Preflight
and normal capture use the same launcher. The private macOS responsibility API is
a tested dependency; missing support fails setup explicitly.

Installation serializes setup, stages and verifies files before replacement, and
restores the prior files on a failed commit. Failed rollback preserves recovery
files and the installation lock for inspection. A normal macOS consent grant and
physical audio acceptance are still required. A successful process-tap check
alone does not establish consent.

## Streaming playback

SoX must read the live PCM input until EOF. Its raw reader can otherwise infer a
finite length from macOS socket metadata and truncate an ongoing conversation.
The input length override applies to both initial and interruption replacement
processes. This fixes truncation, not the separate physical audio acceptance gate.
