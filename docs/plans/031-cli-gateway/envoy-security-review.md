# Envoy security review for the Puddles CLI gateway

**Date:** September 26, 2026 · **Type:** focused source and supply-chain review, not a security certification.

**Historical review:** the subsequent [architecture decision](security-resolution.md) removed Envoy from v1. Findings and the assessment below are retained as the original review record; [Plan 031](../031-rocket-money-integration.md) is the current implementation design.

## Assessment

Envoy is a credible, widely adopted open-source dependency. I found no evidence of covert vendor telemetry or deliberate exfiltration in the startup, configuration, forwarding, and observability paths inspected. That is a bounded finding, not proof that every source file, dependency, or published binary is safe.

**Keep Envoy as a candidate, but do not attach real credentials to the current design yet.** Its `ext_proc` filter does not guarantee an explicit approval for every request/response: a processor can close its gRPC stream successfully and Envoy continues without further processing. This matters directly to our GraphQL validation and response-secret removal. Other concrete hazards are unverified upstream TLS by default, credential-bearing debug logs, and an unsuitable bundled demo configuration.

These are upstream behaviors and deployment/design risks. This review did not discover a malicious implant or demonstrate an exploit against a running Puddles deployment; no gateway is deployed.

## Adoption and maintenance

- **Open source:** Apache-2.0 license in the reviewed [source tree](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/LICENSE).
- **CNCF graduated:** graduated on November 28, 2018. This is evidence of sustained ecosystem maturity, rather than a security guarantee. [CNCF project record](https://www.cncf.io/projects/envoy/).
- **Istio:** its sidecar architecture uses an extended Envoy proxy for data-plane traffic. This does not mean every Istio deployment or mode uses the same configuration or binary we would. [Istio architecture](https://istio.io/latest/docs/ops/deployment/architecture/).
- **Google Cloud:** documents Envoy as the implementation of its regional external Application Load Balancer and as supporting advanced traffic management in its global external Application Load Balancer. [Google architecture](https://cloud.google.com/load-balancing/docs/https).
- **Security maintenance:** a published disclosure process and coordinated patch releases. The reviewed version includes security fixes and `ext_proc` lifetime fixes. [Security policy](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/SECURITY.md), [v1.39.1 release](https://github.com/envoyproxy/envoy/releases/tag/v1.39.1).

My judgment: this adoption meaningfully raises confidence in maintenance and review compared with a small, little-used proxy project. It does not validate our custom provider, browser authentication, or filter ordering.

## Scope and method

Reviewed official release **v1.39.1**, resolved locally to commit **`b579d07d3ad7ee11d32b105e91a5a39ad24718d7`**. GitHub reported it as the latest release during this review, published August 27, 2026. Recheck before deployment; this is not a permanent version recommendation.

Fetched the upstream repository into a temporary directory and inspected selected implementations, API definitions, upstream tests, release workflows, Docker packaging, release metadata, public advisories, and official adoption documentation. Broad searches covered URL literals and telemetry-related terms; narrower inspection traced configuration into outgoing calls, TLS validation, processor failures, logging, and admin facilities. String searches were reconnaissance, not a complete call graph or malware detector.

No credentials, browser profiles, or real financial requests were used. No Envoy binary was installed or executed. Docker was unavailable because its local daemon socket did not exist; upstream tests were **read, not run**. No complete dependency audit, fuzzing, binary/source equivalence check, or packet capture was performed. [Machine-readable evidence](envoy-review-evidence.json) records the snapshot and artifact identifiers.

All source links below are pinned to the reviewed commit.

## Findings

### 1. High — successful processor close bypasses further inspection

The gRPC client dispatches status `OK` to `onGrpcClose()`. That path sets processing complete and calls `clearAsyncState()`, which resumes paused processing. Unlike error and timeout handling, this path does not consult `failure_mode_allow`.

The upstream `testGetAndCloseStream` deliberately closes successfully without a processing response and expects an upstream request and HTTP 200. `GetAndCloseStreamOnResponse` similarly closes at response headers and expects HTTP 200. This is intentional protocol behavior, not evidence of a new vulnerability.

**Impact on Puddles:** a provider implementation that returns normally too early can skip policy checks. If credentials were already injected, a later unvalidated body could proceed. A close during response processing can also skip cookie/header removal or body inspection. Delaying credential injection reduces request risk but does not solve response release or unauthenticated weather requests.

**Required change:** retain `failure_mode_allow: false`, but do not use it as the sole approval boundary. Prove independent, non-spoofable approval gates for complete request validation and complete response inspection using supported mechanisms. Reject missing approvals, early successful closes, errors, and timeouts. If this cannot be made simple and demonstrable, keep upstream execution and response release in the trusted provider service instead of relying solely on `ext_proc`. No fork. This remains an architecture acceptance blocker, not an implemented mitigation.

Evidence: [gRPC close dispatch](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/filters/common/ext_proc/grpc_client_impl.h#L225), [filter close handling](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/filters/http/ext_proc/ext_proc.cc#L1975), [resume logic](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/filters/http/ext_proc/processor_state.cc#L580), [request test](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/test/extensions/filters/http/ext_proc/ext_proc_integration_common.cc#L723), [response test](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/test/extensions/filters/http/ext_proc/ext_proc_integration_test.cc#L301).

### 2. High — TLS encryption alone does not authenticate upstreams

`UpstreamTlsContext` explicitly documents that server-certificate verification is not enabled by default. The default validator begins with `SSL_VERIFY_NONE`; trusted CA configuration changes the validation path. Merely specifying TLS and SNI is insufficient.

**Required change:** configure trusted roots plus the expected DNS SAN/hostname for each fixed API upstream. Use the private CA and expected service identities for the provider mTLS connection. Reject expired certificates, wrong names, and unknown issuers. Do not allow caller-controlled SNI/authority to choose what identity is trusted, `ACCEPT_UNTRUSTED`, or fallback plaintext.

Evidence: [TLS API](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/api/envoy/extensions/transport_sockets/tls/v3/tls.proto#L28), [validator implementation](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/common/tls/cert_validator/default_validator.cc#L123).

### 3. High — debug logging can disclose injected credentials

The router logs request headers at debug level. `ext_proc` logs the processing response's `DebugString()`, which can include header mutations containing injected cookies or authorization. Response headers are also logged in HTTP processing. Redacting the CLI output does not redact these logs.

Admin exposes logging-level changes, configuration dumps, and diagnostic/profiling facilities. Config dump redaction follows protobuf sensitivity annotations; it is not a universal sanitizer for arbitrary strings or request headers. Warning/error paths can also log provider error messages, so a log-level restriction is necessary but insufficient.

**Required change:** no debug/trace or fine-grained logging overrides with live credentials; no request/response dumps, tap, secret-bearing error text, or external log shipping. Use minimal allowlisted audit fields. Disable admin by default; if needed, place it on a separate operator-only interface. Keep config, process control, logs, dumps, and startup environment inaccessible to agent sandboxes. Test canary secrets against all outputs, including Docker logs.

Evidence: [router headers](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/common/router/router.cc#L880), [processor debug response](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/filters/http/ext_proc/ext_proc.cc#L1840), [HTTP response logs](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/common/http/conn_manager_impl.cc#L2041), [admin handlers](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/server/admin/admin.cc#L127), [redaction implementation](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/common/protobuf/utility.cc#L582).

### 4. High if used unchanged — the image's demo routes to the project website

The Dockerfile bundles `configs/envoyproxy_io_proxy.yaml` as the default config. It routes all matching paths to `www.envoyproxy.io:443`, listens on `0.0.0.0:10000`, and enables admin on `0.0.0.0:9901`. It sets TLS SNI without a trusted CA. The DNS cluster may resolve the project hostname independently of application requests.

This is visible example configuration, not a hidden telemetry implant. Nevertheless, sending sensitive requests to an uncustomized container could send them to the wrong destination. Container ports are not automatically published to the host, but these listeners exist inside its network namespace.

**Required change:** always supply a complete reviewed config at an explicit path; startup must fail if it is missing. No fallback to the bundled demo. No host TCP publishing for the CLI or admin. Verify only the intended Unix listener and fixed clusters are active.

Evidence: [image construction/default command](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/distribution/docker/Dockerfile-envoy#L7), [bundled configuration](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/configs/envoyproxy_io_proxy.yaml#L1).

### 5. Medium — rejected header mutations can be silently ignored

The mutation checker defaults `disallow_is_error` to false and returns `IGNORE` for rejected mutations. Upstream tests cover both ignoring and failing. A processor response being received is therefore not sufficient evidence that every intended removal/injection occurred.

**Required change:** explicitly enable `mutation_rules.disallow_is_error`, restrict the permitted mutations, and test rejected mutations and credential removal. Keep destination/route selection protected; disable processor mode overrides and unnecessary route-cache changes. This complements, but does not fix, finding 1.

Evidence: [mutation checker](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/filters/common/mutation_rules/mutation_rules.cc#L39), [upstream tests](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/test/extensions/filters/http/ext_proc/filter_test.cc#L3913).

## Outbound communication and telemetry

The inspected code ties stats sinks to `bootstrap.stats_sinks`, tracing/access logs to HTTP connection-manager configuration, and remote control-plane clients to dynamic-resource configuration. OpenTelemetry exporters use configured gRPC/HTTP services; gRPC access logs use a configured service. These are legitimate data-export paths that must stay disabled in our deployment. The Datadog adapter explicitly disables its dependency's own telemetry.

Request mirroring can copy requests to another cluster; tap can capture bodies to configured outputs. Dynamic configuration and loadable extensions expand who can control destinations and data handling. Do not enable those features, dynamic forward proxy/original-destination routing, CONNECT/upgrades, remote code loading, or automatic internal redirects in this gateway.

Evidence: [stats/tracing startup](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/server/configuration_impl.cc#L160), [HTTP logging/tracing activation](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/filters/network/http_connection_manager/config.cc#L642), [OpenTelemetry exporter](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/tracers/opentelemetry/opentelemetry_tracer_impl.cc#L92), [Datadog telemetry setting](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/tracers/datadog/tracer.cc#L41), [mirroring](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/common/router/router.cc#L907), [tap outputs](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/common/tap/tap_config_base.cc#L48), [dynamic cluster activation](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/common/upstream/cluster_manager_impl.cc#L450).

**Independent containment is required for the exfiltration concern:** default-deny gateway egress outside Envoy, allowing the fixed provider endpoints, private processor connection, and a controlled DNS resolver. Constrain DNS names as well as destinations; unrestricted DNS can itself leak data. An Envoy config is not a boundary against compromise of Envoy itself. The native provider/browser needs its own explicit network policy based on observed authentication dependencies. Allowlisting reduces exposure but cannot eliminate covert channels to allowed destinations or downstream responses.

## Release and binary trust

The official release provides a PGP-signed checksum document. Its ARM64 core binary checksum matches the checksum in GitHub's release metadata. **The PGP signature was not cryptographically verified**, and no binary was downloaded to check those bytes. Signature verification still requires an independently established trusted release-key fingerprint.

The public registry returned these identifiers for `envoyproxy/envoy:distroless-v1.39.1`:

```text
image index: sha256:eb2c01c13125d1629637cb4e4cce7207009fb7cc2c8027f9742758549d15b6f4
linux/arm64: sha256:62649e9cb5073a995b57d888f98382927ad15e91c53affac92a8a48a365027db
```

The ARM64 image configuration declares user `65532` and directly executes `/usr/local/bin/envoy`. These are recorded registry observations, not a signature or source-to-image attestation. Pin the reviewed image by digest, use the core distroless variant, and verify the artifact before deployment. A digest prevents tag drift but does not establish who built it.

The inspected Docker build disables automatic BuildKit SBOM/provenance output. That does not prove no attestations exist elsewhere, but we cannot assume the image carries verifiable provenance. The signed release checksum list covers binaries/packages, not these image manifests. Audit the final image and dependencies, establish an artifact verification procedure, and rerun focused regressions on upgrades. Prefer an upstream-supported artifact over maintaining a fork.

Evidence: [release assets](https://github.com/envoyproxy/envoy/releases/tag/v1.39.1), [signing workflow](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/.github/workflows/_publish_release.yml#L39), [build provenance flags](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/distribution/docker/build.sh#L135), [image variants](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/docs/root/start/install.rst).

The reviewed release fixes recent HTTP/2, HTTP/3, path-policy, admin, and authorization issues, plus `ext_proc` lifetime bugs. This supports using a patched release and minimizing enabled protocols, not claiming the release has no remaining vulnerabilities. Envoy's policy treats side-call services as trusted and excludes contrib extensions from security-team coverage. Use the stable downstream HTTP `ext_proc` placement, not its alpha upstream placement. [Threat model](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/docs/root/intro/arch_overview/security/threat_model.rst), [extension metadata](https://github.com/envoyproxy/envoy/blob/b579d07d3ad7ee11d32b105e91a5a39ad24718d7/source/extensions/extensions_metadata.yaml#L514).

## Required validation before live credentials

- [ ] Resolve finding 1 with tested approval gates for both directions, or revise the transport boundary; no fork.
- [ ] Fault-inject successful early gRPC closes before request headers/body and response headers/body; prove no unapproved request or uninspected response escapes.
- [ ] Test disconnects, errors, deadlines, malformed/out-of-order replies, rejected mutations, missing credentials, partial bodies, and oversized messages.
- [ ] Verify upstream CA/name/expiry checks and provider mutual authentication using fake certificates; no secret-bearing application request reaches an untrusted peer.
- [ ] Use synthetic canary cookies/tokens/bodies; check logs, error replies, trailers, metadata, admin, and crash-dump handling for leakage.
- [ ] Validate the actual immutable config, socket mounts, fixed destinations, redirects, header stripping, resource limits, and sandbox/caller isolation.
- [ ] Capture startup, idle, request, renewal, and failure traffic with synthetic data; enforce and test independent egress/DNS restrictions.
- [ ] Verify the exact deployed artifact, scan its dependencies, record hashes, and rerun these regressions when upgrading.

Source review is complete for the stated scope. The unchecked items are deployment acceptance work, not tests claimed to have passed in this review.
