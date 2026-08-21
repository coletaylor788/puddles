# Design collaboration workflow

Status: Draft for Cole review
Issue: https://github.com/coletaylor788/puddles/issues/105
Last updated: 2026-08-20

## Human section

### Design

Feature work today starts with a task in the tracker. An agent picks it up, does research, decides on a design, and writes it into a plan and an issue. Cole reads the result and comments back through the tracker. Each clarification costs a full pickup, work, write, and review cycle, so a design conversation that would take ten minutes in person takes hours or days. Worse, the agent cannot pause to ask, so it commits to an interpretation and keeps going. The design that comes back is often not the one Cole wanted, and the gap only shows up after the work is written down.

The second problem follows from the first. Because no approved design exists when implementation starts, the independent review at the end has to judge the design as well as the code. Review findings become architectural arguments, each round can surface a fresh objection, and the loop has no natural end. The review skill already carries several rules that try to talk the reviewer out of over-reporting, which is a sign that the scope itself is too broad rather than that the reviewer is behaving badly.

This plan separates the two things that are currently tangled. Design becomes a live conversation between Cole and an agent, held in a real-time session rather than through the tracker. The conversation is the point. The agent asks questions, proposes options, and pushes back, and Cole steers, until both agree on what to build and why. That conversation produces one artifact, written in plain prose for a human reader, and it is not finished until Cole approves it. Approval is explicit, and it is the gate that separates thinking from building.

Once the design is approved it becomes an input to the rest of the workflow rather than something the implementing agent invents. The plan file keeps its agent-facing detail, but the design section points at the approved artifact instead of restating it. Implementation, validation, review, and delivery then run to completion without further design decisions. If implementation shows the design is wrong, that is not a review finding to argue about. It sends the work back to a new design conversation, which is cheap now that those conversations are quick.

The independent review at the end narrows to code. It checks correctness, error handling, concurrency, resource lifecycle, test quality, security and privacy in the implementation, and whether the code matches the approved design. It no longer asks whether the design is the right one. A reviewer who believes the design itself is wrong raises that separately to Cole instead of blocking the loop. With design out of scope the findings become checkable facts rather than judgment calls, so the loop should converge in a round or two.

The mechanism is a skill. A skill is a document an agent loads when a task matches it, and it tells the agent how to run that kind of work. This one covers how to hold a design conversation, what the artifact looks like, how the human and agent sections differ, how to write prose a person actually wants to read, and the rule that the human approves before the design is done. The debug agent carries it, since that agent already runs in a live chat and is the natural place for this kind of back and forth. Repository instructions explain when to reach for it.

### Status

This is a draft written from a design conversation with Cole on 2026-08-20. It describes the problem and the shape of the fix. It does not yet specify the skill's contents in detail, the exact approval mechanics, or how the approved artifact is handed to the implementing agent.

Two findings from that conversation still need decisions and are recorded in the agent section below. Private source patches sit outside the integration gate, which is a live gap rather than a process idea. The design artifact's storage location and the review loop's convergence bound are both open. Cole reviews this draft and decides the next step.

## Agent section

### State

- Phase: Draft awaiting Cole review
- Repository: `coletaylor788/puddles`
- Tracking issue: `#105`
- Production mutation: Not performed
- Blockers: Scope and open questions need Cole's decisions before implementation.

### Scope and acceptance criteria

- Add a `brainstorm-enhancement` skill that defines the collaborative design workflow.
- The skill covers issue content, plan structure, the human and agent section split, and the prose rules.
- The skill requires explicit human approval of the design before the design phase is complete.
- Repository instructions describe when an agent should use the skill.
- The debug agent can load and run the skill in a live session.
- Narrow the independent review to code and design conformance, and route design objections to Cole instead of into the remediation loop.
- Do not weaken any existing safety, validation, or publication boundary.

### Architecture and decisions

The workflow splits into two phases with one gate between them.

| Phase | Who drives | Output | Gate |
| --- | --- | --- | --- |
| Design | Cole and agent together, live | Approved design artifact in prose | Cole approves explicitly |
| Delivery | Agent, autonomous | Implementation, tests, review, landed change | Existing lifecycle gates |

Decisions made so far:

- The design conversation happens in a real-time session, not through tracker comments. Latency is the main cost being removed.
- The design artifact is prose for a human reader. It carries no file paths, function names, commands, or commit ids, matching the existing plan design-section rules.
- The artifact is frozen during implementation. A design change requires a new design conversation, not a review argument.
- The independent review covers code and conformance to the approved design. It does not evaluate whether the design is correct.
- The skill lives with the other repository skills so any agent can load it, and the debug agent is the expected caller.

### Implementation

Not started. Sequencing is a decision for Cole. The private-patch test gap is independent of the workflow change and can proceed separately.

### Validation

Not started. The workflow change is documentation and skill content, so validation is mainly a real design conversation run end to end against this plan's own structure. Any code change that comes out of this plan carries committed regressions and passes `node packages/e2e/bin/openclaw-test-env.mjs ci`.

### Rollout and rollback

Not started. Skill and instruction changes roll back by reverting the commit. No production state changes.

### Review log

No independent review yet. This draft came from a design conversation on 2026-08-20 and reflects Cole's stated goals: remove tracker round trips from design, get a human-readable design artifact agreed before building, and stop the independent review from spending cycles on design.

### Open questions

1. Does the approved design artifact live in the repository as its own file, or inside the plan's design section, or in the issue? Repository storage makes it reviewable and versioned.
2. Does the design conversation also produce the plan skeleton and the tracker item, so approval starts delivery automatically?
3. What bounds the review remediation loop: a fixed number of rounds, a time box, or neither?
4. Private source patches are currently outside the integration gate. Five patches on the local OpenClaw stack are absent from `packages/e2e/openclaw-patch-suite.json`, and two of those carry no test files. Does the existing pool grow to cover them, or does a second pool own them?

### Checklist

- [ ] Cole reviews this draft and answers the open questions
- [ ] Skill content specified
- [ ] Skill added and loadable by the debug agent
- [ ] Repository instructions updated to describe when to use it
- [ ] Independent review scope narrowed to code and design conformance
- [ ] Workflow exercised on one real feature end to end
- [ ] Plan marked complete with date
