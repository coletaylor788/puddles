# CLI integration setup

**Prepared for later installation. Do not apply while the OpenClaw upgrade is in
progress. Merge and activation require Cole's approval after rebase and checks.**

The trusted OpenClaw host user owns one installation outside every agent workspace
and sandbox mount. Use a real absolute path with no symlink ancestors. Directories
are 0700; policy and auth state are 0600. Do not put the runtime or browser profile
in shared agent storage. No new image, service, socket, or TLS certificate is needed.

1. Build the plugin with `corepack pnpm --filter cli-gateway build`. Create a
   Python 3.11+ venv at `<install>/.venv` and install `packages/cli-gateway` into it.
   Install its pinned Chromium with `<install>/.venv/bin/python -m playwright install chromium`
   as the host user, outside agent mounts. A release must pin the source revision
   and record the installed dependency/browser versions; editable development
   installations are not release artifacts.
2. Run `configure.py --input <existing-openclaw.json> --output <new-openclaw.json>
   --install-root <install> --plugin-dist <built-plugin-dist>`.
   Optional `--main-workspace` and `--household-workspace` install selected skills;
   the main rules file is seeded once and never overwritten. These paths must be
   the actual respective agent workspaces. The script never restarts OpenClaw.
3. Review the new config before activation. Existing agents need explicit
   allowlists; all agents must use offline sandboxes with host/elevated execution
   disabled and no mounts exposing private runtime/state or container sockets.
   Review any other installed host tools for bypasses. The generated config is
   a proposed copy, not proof of runtime enforcement.
4. After upgrade compatibility and tool-denial checks, perform initial sign-in
   from the host terminal:
   `<install>/.venv/bin/rmoney --config <install>/policy.json --agent main
   --tool rocket_money_read --setup`.
   Complete MFA in the managed browser. Never paste credentials into chat.
5. Verify a read, expire only the managed application's session, verify silent
   recovery, restart the application, and test recovery again. Check the logged-in
   viewer remains the same and that no secrets appear in agent results. Confirm
   Keychain/profile access after host reboot. Stop on interaction_required;
   unattended access has not been proven until these checks pass.
6. Verify category/date changes only on a separately approved reversible example,
   including budget-month placement and readback. Confirm household cannot call
   finance tools or access finance memory; confirm agent exec cannot reach host
   runtime/state/network. Use the shared DEV lifecycle and recording adapters
   before touching production. Activate only through the normal deployment tools.

The generator preserves unrelated tools and skills, adds exact grants, and writes
new policy/config files. Existing policy is never overwritten. For updates, edit
operator-owned policy deliberately; removing a grant blocks new calls, while an
already dispatched write can finish. Revoke all three tools to disable the feature.

For auth recovery, inspect `mode=status`; run operator setup if interaction is
required. Account mismatch requires investigating the account binding, not
silently replacing identity.json. For uncertain writes use `operation_status`
and fresh transaction reads, then resolve with Cole. Never delete state or resend
as a recovery shortcut. Back up private state only to protected storage.
