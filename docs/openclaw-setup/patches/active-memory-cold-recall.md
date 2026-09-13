# Bounded cold recall

This patch applies to OpenClaw v2026.9.3. Active Memory runs a small optional
trigger lookup before its required recall in `always` mode. The lookup is
lexical, but the memory manager still checks and initializes a required
embedding provider. A cold local provider can therefore exhaust the outer
preflight timer before required recall gets its configured setup allowance.

For eligible `always` recall, start the existing recall deadline before the
trigger lookup and never restart it. Deduct elapsed trigger setup from the
configured setup grace before starting deep recall. The model timeout stays
unchanged. Policy and session checks still have 1500 milliseconds. The optional
lookup keeps its own 1500-millisecond cap and also observes the owning deadline.
Other modes, destination checks, tool authority, and recall sources do not
change. No fallback provider or new timeout setting is added.

The patch changes the bundled Active Memory plugin, not a separately installed
provider. Rebuild and package the normal runtime. The cumulative suite runs the
plugin's index, trigger, config, and escalation tests. The added delayed-provider
cases reproduce the original preflight failure, require recall within the
shared allowance, and require an explicit timeout when that allowance expires.
The release owner must also run the installed cold-provider fixture without
prewarming before integration.

Rollback restores the previous runtime archive through the deployment wrapper.
The patch does not change configuration or stored memory.
