"""Retired live-account suite. Automated integration uses recording adapters."""

import pytest

# The former fixtures sent real messages and attempted permanent deletion.
# Keep direct invocations inert; coverage lives in the offline unit suite and
# packages/e2e/scenarios/gmail-readable.mjs.
pytest.skip("Use the packaged recording Gmail scenario", allow_module_level=True)
