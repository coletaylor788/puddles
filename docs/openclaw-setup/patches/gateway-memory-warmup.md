# Prepare managed local memory before gateway readiness

OpenClaw normally creates an embedding provider on the first memory request.
The selected local model can take longer to load than the ordinary 15-second
memory request budget. This patch adds the explicit
`memory.search.local.warmupOnGatewayStart` option. When enabled, gateway startup
uses one 90-second allowance to create the configured local provider and verify
two real, finite, nonzero, distinct vectors before channels start.

The warmup accepts only a registered local transport and a gateway-owned local
service. It keeps that service lease and provider open for the gateway lifetime.
Shutdown aborts unfinished preparation, closes providers, and releases leases.
A restart must acquire and prepare the service again. The ordinary memory
request budget and Active Memory's separate 30-second setup cap are unchanged.

Managed llama.cpp preparation sets `sleep-idle-seconds = -1` only in the
embedding model's preset section. Global and chat preset values are preserved.
This disables native idle sleep. It does not pin the model against router
capacity eviction, so the existing model-capacity policy still applies.

Requests to a managed local embedding endpoint use the existing configured
local-origin fetch guard. Ambient proxies and redirects are disabled for that
path. Remote embedding providers keep their existing transport behavior.

Regressions cover explicit opt-in, per-agent opt-out, disabled memory, one
shared deadline, vector validation, startup ordering, restart acquisition,
lease cleanup, managed transport confinement, and embedding-only native
residency.
