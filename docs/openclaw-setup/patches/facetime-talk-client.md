# FaceTime as a native Talk client

This patch targets OpenClaw 2026.11.5 and changes only the FaceTime extension.
The [approved design](../../plans/realtime-cli-steering-and-results.md) replaces
its old custom Gateway carrier API with existing authenticated Talk methods.

## Session attachment

Set `plugins.entries.facetime.config.realtime.mode` to `talk`. The extension
opens a normal Gateway client and calls `talk.session.create` with
`gateway-relay`, `agent-consult`, and the configured main session. Native Talk
owns provider selection, transcript storage, dispatch, steering and completion.
The Gateway grants authority through its existing connection authentication and
scope checks. FaceTime still admits only configured owner handles.

Provider, model, voice, instructions and tool policy come from Talk. Independent
FaceTime overrides are rejected in this mode. It remains inbound-only. Existing
standalone configurations retain the published carrier behavior.

## Audio and call lifetime

The extension forwards PCM audio through `talk.session.appendAudio`, consumes
connection-owned `talk.event` output, and acknowledges provider marks after
playback drains. Startup audio stays buffered until the call's media route is
ready. Events from another relay or a closed call cannot play audio.

Normal hangup calls native close with `disposition: detach`, preserving accepted
work in main. Explicit task cancellation remains native Talk behavior. The
existing FaceTime tool handles delegated requests to end the physical call.
There is no custom phrase classifier, steering queue, progress channel or replay.

Suspension stops model audio immediately. Capture suppression remains until the
native carrier has confirmed closure. Final close joins connection startup and
teardown, including authentication and session-creation races. A failed media
suspension still reaches the carrier safety handler.

## Native packaging

The existing pinned helper package, verified capture launcher and streaming SoX
input are retained. The capture launcher preserves the stable macOS audio-consent
identity. The separate [native companion patch](facetime-native/README.md) retains
its verified muted-answer and closure behavior. Neither requires an OpenClaw
Gateway patch.

## Qualification

The cumulative suite retains FaceTime admission, native helper, audio, packaging
and lifecycle coverage. New extension tests cover attachment to main, readiness,
playback acknowledgements, stale events, detached work, startup/close races and
failed suspension. Native Talk and the upstream-based command patch supply the
agent routing and steering regressions.

Installed acceptance must also prove real subscription CLI delegation, ongoing
conversation, steering and proactive completion. Local fixtures do not establish
physical call readiness. CI deploys and recovers the same qualified artifact.
