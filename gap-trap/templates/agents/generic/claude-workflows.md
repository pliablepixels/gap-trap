# Claude workflow playbook

Advisory, not binding. Last validated 2026-09 against Claude Code with the
Claude 5 family, in the repo gap-trap was extracted from. The instruction files (`AGENTS.md`, `AGENTS.project.md`)
state what must hold; this playbook records what has worked. When the two
disagree, the instruction files win. Harness features churn; check the date
above before trusting specifics.

## Scale ceremony to risk

What scales with risk is review ceremony: a one-file fix with a covering
test needs no independent reviewer, while multi-task plans, refactors with
blast radius, and contract changes do. Delegation has a floor too; see
Orchestration. Evidence from the origin repo: reviews of mechanical
transcription tasks found zero defects; reviews of judgment work (doc
remapping, whole-branch review) found every real one. Review where judgment
lives; skip where the gate already proves the result. The final whole-branch
review before a PR is the one step never skipped, and it runs on two axes in
two separate contexts: a Standards agent judging the diff against the
contracts and playbooks (skipping anything a gate enforces), and a Spec agent
judging the diff against the issue's acceptance lines (missing, unrequested,
looks-implemented-but-wrong, each quoting the issue). Findings stay under
their own heading, never merged or reranked: a change can pass one axis and
fail the other; in the origin repo two fix chains passed every gate while
missing what the issue asked. Agent count is a cost,
never a quality signal: prefer the fewest dispatches that produce the
evidence, and let the harness parallelize instead of choreographing a
named fleet.

## Orchestration

- The orchestrator (the main session, or a team lead coordinating others)
  runs on Opus 4.8 or newer; never a smaller model. Coordination quality
  bounds everything downstream: a weak orchestrator writes weak briefs,
  misreads reports, and wastes every strong agent under it. An instruction
  file cannot switch a running session's model, so pin the default in
  `.claude/settings.json` (`"model": "opus"`); if your session runs on
  something smaller anyway, say so and suggest `/model`.
- Implementation delegates to subagents by default: the orchestrator's
  context stays clean for briefs, report verdicts, and review decisions,
  and an orchestrator that edits files skips its own review structure.
  Exception: a trivial gate-covered edit (single file, no judgment, a gate
  proves the result) costs more to brief than to make; edit it directly
  and run its gate.
- Let the harness decide how many agents run and when they parallelize.
  Choose what each dispatch is for; do not choreograph counts.

## Multi-agent execution

- One subagent per task, fresh context each time. Hand each agent a brief
  file (its requirements) and a report-file path; it returns only status,
  commits, and a one-line test summary. Never paste session history into a
  dispatch.
- Model tiering: cheapest model when the task text contains the complete
  content to write (transcription plus testing); mid tier for code reviews;
  the most capable model only for the final whole-branch review. Tasks whose
  output is prose (docs, reports, prose review with slop-mop) run on Opus or
  newer. Smaller models follow slop-mop's word lists but skip the checks that
  need judgment.
- Tasks involving judgment get an independent review against their brief
  before the next task starts; purely mechanical tasks rely on their gates.
  Fixes get a scoped re-review that verdicts each finding ADDRESSED or NOT
  ADDRESSED and looks only at the fix diff.
- After the final whole-branch review, dispatch one fix wave with the whole
  findings list, then one scoped re-review. Never one fixer per finding.
- Stop every agent as soon as its report is verified. Idle agents keep
  burning context and can wake with stale intent.
- Long-running work keeps a ledger file (task, commits, review outcome, one
  line each) outside the repo tree. Context compaction loses memory; the
  ledger plus `git log` is the recovery map.

## Trust boundaries for tooling

- A reviewer only re-runs tests when the code changed after the last run;
  otherwise the implementer's report carries the evidence.
- Repo-wide greps run from the repo root or with absolute paths; a cwd of
  a subdirectory silently misses everything above it.
- Never gate a commit on a piped command (`npm test | grep ...`): the
  pipeline exits with the last command's status and a failing suite reads
  as success. Run the gate bare, check its exit, then filter output
  separately. This shipped a red commit here once.
- A CI job that skips its own steps still reports green. Before trusting a
  required check, read what it ran: two required checks here passed on every
  PR for months, one whose workflow had been deleted and one that skipped
  itself for a missing secret (M2).
- Merging waits for green CI, but never by polling: queue it with
  `gh pr merge --auto` at PR creation and GitHub merges when checks pass.
  Caution: if the repo's auto-merge setting is off, `--auto` silently
  falls back to an immediate merge; that landed one PR here before its
  checks finished. Confirm `allow_auto_merge` is true before relying on
  it.

## Where knowledge goes (M5 in practice)

- Project fact (API quirk, platform behavior, failed approach): the domain
  playbook in the project playbook directory, via the protocol PR. Check
  whether an entry already covers it; update rather than duplicate.
- Workflow practice that proved out (a review pattern, a model-tier choice,
  a tooling guard): this playbook or a sibling generic playbook, via the
  same protocol. Personal preference becomes shared practice exactly when
  it has evidence behind it.
- Agent private memory holds only what the repo must not: personal and
  private specifics (names, hosts, credentials, machine paths) and habits
  with no evidence yet. Memory is a staging area, not an archive; when a
  memory keeps proving true, promote it and delete the private copy.

## Known failure modes this playbook exists to prevent

- A compression wrapper garbled test output and hid a failure; the direct
  command showed it immediately.
- Reviewers approving their own implementation. Separate agents, always.
- Doc references that drift silently from renumbered rules; the
  instruction gate catches the repo cases, but dispatches into agents
  should cite rule IDs, not copied text, for the same reason.

## Multi-agent lessons (origin repo, 2026-08)

- The task brief is the reviewer's contract. Anything added only in the
  dispatch prose is invisible to the reviewer; fold every dispatch-time
  addition into the brief or expect false scope-creep findings.
- Match the reviewer to RISK, not size. Concurrency, token handling, and
  native-adjacent diffs get the top-tier reviewer on the first pass.
- Keep a task's reviewer alive until its scoped re-review completes.
- Fix waves on concurrency-heavy subsystems create defects (three
  consecutive waves each introduced one). Budget a scoped re-review per
  wave; a fresh Critical inside a wave is fixed, never parked.
- Subagent final plain text often never reaches the controller. Every
  dispatch states: report via SendMessage to the controller.
- Briefs cite symbols and anchors, never line numbers; line refs rot
  within hours on an active branch.
- A one-line fix the reviewer itself specified needs no re-review round.
- Full-gate runs happen once per wave, at push time. Fix rounds run the
  scoped suites plus the gates their change class implicates.
- One checkout, many agents: the branch can change under you between
  edit and commit. Verify `git branch --show-current` before every
  commit; make out-of-band commits from a temporary `git worktree`.

