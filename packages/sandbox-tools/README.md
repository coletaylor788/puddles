# Sandbox document and media tools

This component adds local PDF, image, audio/video, and TypeScript tools to the
OpenClaw agent Docker sandbox. Host runtime dependencies are not mounted into it.
The final image retains the non-root UID 1000 user and ordinary workspace mounts.

Build the reusable image from this directory:

```sh
docker build -t puddles-sandbox-media:dev .
```

The pinned Emscripten stage compiles the exact upstream FFmpeg WASM revision and
codec sources. Only compiled output, license notices, Node, runtime npm packages,
and image codecs enter the final image. The npm lock records integrity hashes.
Builds require network access; installed file processing does not.

Run focused tests with `node --test test/*.test.mjs`. Exercise the complete image:

```sh
docker run --interactive --rm --network none --read-only --tmpfs /tmp:rw,size=256m \
  puddles-sandbox-media:dev node --input-type=module < test/installed.mjs
```

Acceptance uses only generated files and runs as the sandbox user. It checks
actual PDF text and pixels, image dimensions including HEIC and AVIF, audio sample
rate, video extraction and trimming, malformed files, overwrite refusal, and JS/TS
imports from a separate working directory. Run it again in a fresh container to
prove recreation. Required capabilities fail rather than skip.

See [agent guidance](SKILL.md) for commands and supported formats. Make this skill
available through the existing OpenClaw skill installation and workspace mirror.
No daemon, credentials, new service port, or browser image change is required.

The configured companion application builder packages this image as part of the
prepared application output. Its full application gate requires media acceptance.
Public Linux CI also builds, exports, loads, and tests the image. The generic public
macOS application build does not select a Docker sandbox. DEV and TEST must
select the exact image ID and run the same installed checks. Before production,
retain the previous image identity for rollback. The release controller owns
activation, acceptance, source merge, and recovery. Never build during activation.

A CI host can set `PUDDLES_SANDBOX_BUILDER` to its explicitly owned
`puddles-ci-*` Buildx builder. This path requires the `docker-container` driver
and exports an untagged Docker archive directly, without loading it into the
daemon. The builder owner must serialize builds, enforce cache/free-space
budgets, and maintain the builder. The artifact records its builder and archive
identity, and incompatible cached archives rebuild automatically.

`PUDDLES_CI_DOCKER_IMPORT` can bind an installed lifecycle adapter using JSON
absolute `node`, `script` and `config` paths. Installed load/test operations call
that adapter with `load`, `test` or `test-existing`, the configuration path, and
the runtime. The adapter owns durable image/container registration, interruption
recovery and reference-aware retirement. Without this binding, the ordinary
direct Docker commands remain available.
