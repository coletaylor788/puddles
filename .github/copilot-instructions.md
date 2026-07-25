# Puddles - Copilot Instructions

> ⚠️ **DO NOT USE THE `ask_user` TOOL.** When you need clarification or a decision, just ask in plain words in your response. No tool call.

A monorepo for the Puddles personal-agent stack: MCP servers, OpenClaw plugins, Mac Mini host scripts, and setup docs.

**Target clients:** Claude, Claude Code  
**Runtime:** Local only

## Principles

1. **No bloat** - Only write code needed for the feature. Remove unused code, imports, and files.
2. **Keep it simple** - Don't over-engineer or add speculative features. Build what's asked for.
3. **Auth stays local** - All credentials and tokens stay on the user's machine. Never commit secrets to the repo.

## Workflow

### 1. Understand First
Before making changes, read the relevant docs:
- Root `docs/plans/` - Cross-cutting implementation plans
- `servers/<name>/docs/` - Server-specific documentation
- `servers/<name>/README.md` - Server setup and usage

Read any other docs that exist - this is the source of truth for the project.

### 2. Plan Before Implementing
For new features or significant changes:
1. Create a plan document:
   - Server-specific: `servers/<name>/docs/plans/NNN-feature-name.md`
   - Cross-cutting: `docs/plans/NNN-feature-name.md`
2. Include: summary, API details, implementation steps, testing approach
3. **Include a checklist section** (see template below)
4. **Wait for user approval before proceeding to implementation**

#### Plan Checklist Template
Every plan must end with a checklist. **The checklist is a live status document** - check off items immediately as you complete them, not at the end.

```markdown
---

## Checklist

### Implementation
- [ ] Step 1 description
- [ ] Step 2 description
- [ ] ...

### Testing
- [ ] All unit tests written
- [ ] All unit tests passing
- [ ] Integration tests written (if applicable)
- [ ] Integration tests passing (if applicable)

### Cleanup
- [ ] Code linting passes (`ruff check src/ tests/`)
- [ ] No unused imports or dead code
- [ ] Code is readable and well-commented where needed

### Documentation
- [ ] README.md updated (if user-facing changes)
- [ ] docs/architecture.md updated (if architecture changed)
- [ ] Plan marked as complete with date
```

**⚠️ After all checklist items are complete, commit and push your changes.**

### 3. Implement
- Follow the coding guidelines below
- Make incremental, testable changes
- **Check off each checklist item immediately after completing it** - the plan is a live status document
- If you need to undo something, uncheck the relevant items

### 4. Test
- Run unit tests: `pytest tests/`
- Run linter: `ruff check src/ tests/`
- **Check off testing items immediately as each test passes**
- If tests fail, fix the code, then check off when passing

#### Shared cumulative integration pool

Every feature, behavior change, and bug fix must contribute a committed
regression to the shared test pool and run the entire accumulated pool before
merge:

- Use `packages/e2e/` for cross-component, deployment, and OpenClaw patch
  integration coverage. Keep focused package tests beside their implementation
  as well.
- Run `node packages/e2e/bin/openclaw-test-env.mjs ci`. This is the required
  managed lifecycle whenever that runner exists on the active branch.
- OpenClaw source patches must add or update tests in the patch and register
  every applicable test target in
  `packages/e2e/openclaw-patch-suite.json`. The manifest is cumulative: do not
  replace prior regressions with only the newest feature's tests.
- Tests embedded only inside a `.patch` are insufficient unless the shared
  runner exposes and executes them. Temporary session mocks or uncommitted
  checks do not count.
- The pull request must visibly contain the committed test artifact and report
  the exact shared-pool command. Do not declare a behavior change complete when
  only unit tests or only the newly added test passed.
- Live production checks must remain read-only and must never deliver messages.
  Route all write and delivery behavior through deny-by-default recording
  mocks.

### 5. Clean Up
- Remove any unused code, imports, or files
- Simplify overly complex logic
- Re-run tests to confirm nothing broke
- **Check off cleanup items as you complete them**

### 6. Update Docs
After implementation is complete:
- Update relevant docs in `docs/` if architecture changed
- Update `README.md` with new user-facing features
- Mark plan as complete with date in the status line
- **Check off documentation items in the plan**

### 7. Adversarial Review
For every feature or behavior change:
1. Finish all feature and documentation changes, including plan status and
   checklist bookkeeping
2. Launch a separate review agent that did not implement the change
3. Instruct the agent to invoke the repository-local `adversarial-review` skill
   and review the complete feature diff
4. Resolve every actionable, high-confidence finding: fix it and rerun the
   applicable tests and lint checks, or record why it is rejected or accepted
   as a residual risk
5. Repeat with a fresh independent review agent until no actionable,
   high-confidence findings remain unresolved
6. If the feature diff changes after a clear review for any reason, including
   plan or checklist bookkeeping, rerun validation and repeat the fresh review

This gate is mandatory even when the normal implementation and tests pass.

### 8. Commit & Push
After all checklist items are complete:
- Commit all changes with a descriptive message
- Push to remote

### 9. Verify Complete
**You are not done until every checkbox in the plan is checked and changes are pushed.**

### OpenClaw Deployment Topology

Before running `docs/openclaw-setup/patches/apply-and-deploy.sh`, identify the
current host (`hostname` or `scutil --get LocalHostName`) and choose the target
mode explicitly:

- **Running on the target Mac mini:** leave `MINI_HOST` unset. The wrapper builds,
  installs, restarts, and refreshes the browser sandbox locally. Do not require
  SSH or a second build host, and do not try to SSH back into the same machine.
- **Running on another host:** set `MINI_HOST=<approved-target-host>`. Only this
  explicit remote mode uses `scp` and `ssh`.

Never infer that deployment is remote from an old alias or default. A missing
`MINI_HOST` always means local deployment.

### ⚠️ IMPORTANT
- **You are NOT done until the entire plan checklist is complete and changes are pushed.**
- **You may NOT skip any checklist item without explicit user approval.**
- If you cannot complete an item, stop and ask the user before proceeding.

---

## Project Structure

```
puddles/
├── .github/
│   └── copilot-instructions.md  # These instructions
├── README.md                    # Monorepo overview
├── docs/
│   └── plans/                   # Cross-cutting plans
└── servers/
    └── gmail-mcp/               # Gmail MCP server
        ├── .venv/               # Server's virtual environment
        ├── pyproject.toml       # Server dependencies
        ├── README.md            # Server setup & usage
        ├── src/gmail_mcp/       # Source code
        ├── tests/               # Tests
        └── docs/
            ├── architecture.md
            ├── auth.md
            ├── tools.md
            └── plans/           # Gmail-specific plans
```

## Server-Specific Guidelines

### Gmail MCP (`servers/gmail-mcp/`)

**Key Technologies:**
- **MCP SDK**: `mcp` package for Model Context Protocol
- **Google APIs**: `google-api-python-client` for Gmail API
- **OAuth**: `google-auth-oauthlib` for authentication

**Coding Guidelines:**
1. **Async First**: All tool handlers must be async functions
2. **Error Handling**: Wrap Gmail API calls in try/except with helpful messages
3. **Type Hints**: Use Python type hints throughout
4. **Scopes**: Request only the Gmail API scopes needed

**Adding New Tools:**
1. Add tool definition in `list_tools()` with JSON schema
2. Add handler case in `call_tool()`
3. Implement helper function (e.g., `_new_tool()`)
4. Add tests
5. Update server README.md with tool documentation

**Testing:**
```bash
cd servers/gmail-mcp
source .venv/bin/activate
pytest tests/
ruff check src/ tests/
```
