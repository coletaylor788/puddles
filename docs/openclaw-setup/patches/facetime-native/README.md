# FaceTime native companion patches

## Ownership and source

Puddles maintains these fixes as local source patches. They apply to the separate
`openclaw/openclaw-facetime` native companion, not the OpenClaw host source tree.
`manifest.json` pins the upstream commit and ordered patches. Keep this directory
out of the host `apply-and-deploy.sh` patch array.

| Patch | Behavior |
|---|---|
| `call-lifecycle.patch` | Acknowledge an already answered, still-muted shared call; inspect all aliases before confirming carrier closure |

The answer acknowledgement requires the exact verified FaceTime call to be active,
not ended, and to report both mute flags. It performs no second answer or audio
writes. Inspection treats an end date as terminal evidence, scans all aliases,
and preserves unknown calls as present. An ended alias cannot hide a live replacement.
Presence and end-evidence fields serialize as JSON booleans, matching the host's
strict protocol checks. The regressions verify the serialized types.

## Prepare and check

Run from the Puddles root on macOS with its supported Node version and Apple
command-line compiler tools. The output directory must not exist:

```bash
node packages/e2e/bin/facetime-native-patches.mjs /path/to/new-native-source
```

An optional second argument selects an existing local native source checkout as
the object source. It still must contain the exact pinned commit; local changes
are not copied. Without it, preparation fetches only the pinned upstream commit.
The command creates fresh detached source, checks and applies the patches, records
the source tree and patch digests in `puddles-native-source.json`, and compiles and
runs both real dispatch branches against synthetic calls. Existing destinations
are refused without modification. Failed preparation removes only its new output;
a failed check retains prepared source for diagnosis. Interrupted preparation may
leave that new output for owner-verified cleanup before retrying.

The same replay and compiled checks are registered as
`tests/candidate.facetime-native.test.ts` in the FaceTime entry of the cumulative
OpenClaw test manifest. The managed `ci`, `patches`, and `source-gate` commands run
that target on macOS. `FACETIME_NATIVE_SOURCE` can select a local object source for
a focused direct test; the default gate fetches the immutable upstream pin.
These checks never inject helpers, place calls, use audio devices, or open a provider.

## Build and device acceptance

The patch also includes regressions in the companion's normal native test harness.
Use the prepared source's pinned package manager, frozen lockfile, and upstream
build instructions. Run `pnpm test`, `bash scripts/test-native.sh`,
`make native-archive`, and `make native-verify` before selecting a native candidate.
Record the exact patched source tree, toolchain, archive, and installed helper
identity with its deployment evidence.

Preparation alone does not install or certify a binary. `buildFaceTimeNative`
prepares the pinned source, runs compiled dispatch checks, and builds the release
configuration for arm64e and arm64 with an ad-hoc signature. It returns a version-two
source receipt containing the source revision, patches, tree, build ID, signing
kind, and binary SHA-256. This is a locally built image, not a Foundation-signed or
notarized release. An operator may select this path for a private runtime deployment;
do not publish its output as a vendor release asset.

A selected runtime bundles `native-helper.json`, `native/FaceTimeHelper.dylib`, and
the companion license notices. The plugin validates provenance shape, exact bytes,
embedded build ID, and code-signature integrity. The injector repeats verification
on its copied image. Version-one development receipts remain compatible with
local drafts. Missing selection uses the vendor path; invalid selection fails
without fallback. The runtime artifact digest binds the selected files. Build once
before sealing, then retain the same artifact through rehearsal and activation.

Ad-hoc signing establishes code integrity, not an Apple-certified publisher identity.
The reviewed source and sealed runtime establish provenance for this local path.
Preserve the unchanged vendor-signed capture helper and its durable permission
identity. Rollback selects the prior runtime and its prior call-helper receipt.
Restart the call apps after confirming no live calls when changing helper builds;
previously loaded images cannot be replaced inside an existing app process.

Keep FaceTime disabled until the patched native candidate passes device acceptance:
answer once with both observers, exchange audio in both directions, confirm hangup
across retained aliases, and close the voice-provider transport. Retain the previous
native helper for rollback. Passing compiled fixtures is not physical-call proof.
