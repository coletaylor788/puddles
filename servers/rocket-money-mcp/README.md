# Rocket Money MCP

Five scoped finance tools backed by a trusted host browser session. The server
accepts reviewed GraphQL reads and only individual category/date edits. See
[the design](../../docs/plans/031-rocket-money-integration.md) for the contracts.

## Run locally

Install Python 3.11 and Google Chrome. Install this package and
`packages/browser-auth` in a private virtual environment. Then run:

```sh
python -m rocket_money_mcp --state-dir /absolute/private/state login
python -m rocket_money_mcp --state-dir /absolute/private/state serve
```

Login runs on the browser owner's logged-in desktop. Sign in and complete MFA
inside Chrome. Wait for `Rocket Money login verified`. Chrome can save the login;
unattended renewal depends on the site's challenge and Chrome's unlock state.
Never send credentials through chat. Each later call checks the pinned account.
Opening login again focuses an existing private session when it is already owned.

## Deploy

`requirements.lock` pins and hashes all runtime dependencies. Build the plugin,
then run `scripts/build-runtime.py --output /absolute/plugin/dist/python` with
Python 3.11 in a build environment with pip. The output includes the shared auth
package and an isolated `run.py` entry point. Seal the complete plugin and Python
tree as one artifact before installed validation. Run with `python3.11 -I`.
No dependency installation belongs in activation or rollback.

The OpenClaw adapter is in `openclaw-plugins/rocket-money`. Its command is the
host's Python 3.11 executable; all MCP launch arguments come from trusted config.
Keep state outside the immutable artifact and all agent mounts. Configure the
same state directory in the desktop login launcher and the adapter.

The `rocket-money://read-catalog` MCP resource describes supported fields. A main
runtime skill may retain a copy of this public catalog for clients without MCP
resource forwarding. Private finance rules belong in that runtime skill.

## Validation

```sh
python -m pytest servers/rocket-money-mcp/tests -q
python -m ruff check packages/browser-auth/src servers/rocket-money-mcp
```

Tests use synthetic data, including real Chrome against local HTTPS. They never
sign in to a live account or mutate real transactions. A lost write response
stays unknown until a read-back resolves it. Reusing its UUID never replays it.
