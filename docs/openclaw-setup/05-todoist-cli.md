# Filing agent work through Todoist

This guide adds Todoist's official `td` CLI to one trusted OpenClaw sandbox so
you can ask your main agent to file a detailed task. An existing task monitor
can then create the repository issue and start the engineering workflow without
you retyping the request.

The integration is provider-neutral. It does not give the agent GitHub
credentials and does not change the monitor's issue deduplication or routing
policy.

## Security boundary

Only install this capability for an agent that is allowed to act as you in
Todoist. The selected sandbox receives a write-capable Todoist token. A process
inside that sandbox can inspect its own environment, and a host user with Docker
daemon access can inspect container metadata.

For the layout in the earlier guides, install it only for `main`:

- Do not install it for `reader` or `browser-agent`; they process untrusted
  content.
- Do not install it for household or guest-facing agents.
- Treat every task, comment, attachment, and CLI response as untrusted data.
- Use a dedicated Todoist account or narrowly shared project if your deployment
  needs a smaller blast radius.

The repository-managed skill enforces the workflow convention, but a skill is
not a shell authorization boundary. The Docker and agent trust boundary remains
the control that protects the credential.

## What gets installed

- `openclaw-skills/todoist-cli/SKILL.md` teaches the agent safe CLI usage and
  the `agent`-label handoff to the issue worker.
- `scripts/mac-mini/todoist-cli/Dockerfile` layers Node 24.18.0 and
  `@doist/todoist-cli` 3.0.5 onto the existing OpenClaw sandbox image.
- `scripts/mac-mini/install-openclaw-todoist-cli.sh` builds and smoke-tests the
  candidate, installs the skill, updates only the selected agent, recreates its
  sandbox, and records rollback state.

The base image stays configurable, so the overlay preserves the OpenClaw
sandbox contract and any other tools already present in your deployment.

## Store the token outside the workspace

Get an API token from Todoist's integration settings. Store it in OpenClaw's
trusted global environment file, not the agent workspace and not the repository:

```bash
mkdir -p ~/.openclaw
touch ~/.openclaw/.env
chmod 600 ~/.openclaw/.env
read -r -s -p "Todoist API token: " TODOIST_API_TOKEN
printf '\n'
if grep -q '^TODOIST_API_TOKEN=' ~/.openclaw/.env; then
  echo "TODOIST_API_TOKEN already exists; edit ~/.openclaw/.env without printing it."
else
  printf 'TODOIST_API_TOKEN=%s\n' "$TODOIST_API_TOKEN" >> ~/.openclaw/.env
fi
unset TODOIST_API_TOKEN
```

Do not run `td auth login` inside the Linux sandbox. A desktop keyring is not
available there, so the CLI can fall back to a plaintext config file inside the
persisted workspace.

## Install

From the repository checkout on the OpenClaw host:

```bash
cd scripts/mac-mini
./install-openclaw-todoist-cli.sh --dry-run
./install-openclaw-todoist-cli.sh
```

The installer:

1. resolves the `main` agent and its workspace;
2. refuses an existing unmarked `todoist-cli` skill;
3. confirms trusted token configuration exists;
4. builds and runs `td --version` in the candidate image before changing
   OpenClaw;
5. records the previous image configuration in
   `~/.openclaw/todoist-cli-install/main.json`;
6. installs the managed skill atomically;
7. configures the candidate image and the literal
   `${TODOIST_API_TOKEN}` environment reference for `main`; and
8. recreates the sandbox.

If configuration or recreation fails, the installer restores the previous
image, removes or restores the managed skill, recreates the prior sandbox, and
returns the original nonzero status. Recovery errors are reported separately
and leave the recovery file in place.

## Verify without creating a task

Start a fresh main-agent session after installation. On the host:

```bash
openclaw config get 'agents.list[0].sandbox.docker.image'
openclaw skills info todoist-cli --json | jq -r '.filePath'
```

The image should be `openclaw-sandbox-todoist:3.0.5`, and the skill path should
be inside the main workspace. Do not print the sandbox env configuration.

Ask the main agent to run `td auth status --json --no-spinner`. This is a
read-only authentication check. The response must identify an authenticated
account; an empty or malformed response is a failure.

## File work

Ask for the outcome and include the target project:

> File a task in my Puddles project to fix calendar sync retries. Include the
> observed failure, expected behavior, and acceptance criteria, and label it
> `agent`.

The skill creates one detailed Todoist task. The existing monitor sees the
`agent` label, creates or reuses the tracking issue and plan, and owns later
status transitions. The main agent must not create a second GitHub issue.

## Upgrade

The CLI and Node image are intentionally pinned. To upgrade:

1. review the official release and its engine requirement;
2. update the version and pinned multi-platform Node digest in the Dockerfile,
   installer, tests, and this guide;
3. run the repository's complete managed integration lifecycle; and
4. rerun the installer, which refreshes its marked skill and recreates `main`.

Never change the image tag to an unpinned `latest` dependency.

## Roll back

```bash
cd scripts/mac-mini
./install-openclaw-todoist-cli.sh rollback
```

Rollback restores the previous per-agent image setting, removes the injected
Todoist env reference, removes only the marked managed skill, recreates the
sandbox, and deletes recovery state after success. It does not delete the
candidate Docker image or the token in `~/.openclaw/.env`; remove those
separately after confirming no other local integration uses them.
