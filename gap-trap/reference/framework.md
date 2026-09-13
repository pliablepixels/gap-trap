# The framework

What gap-trap installs, in agent terms. The origin is zmNinjaNg
(`docs/developer-guide/14-agent-development-model.rst` there), where one
maintainer landed 2,313 commits in eight months (fourteen reverts) with
agents writing the code and no one reading diffs. This file is the model; the templates
are its files.

## Four kinds of instruction

| Kind | Where | Form | Wins on conflict |
|---|---|---|---|
| Rule | `AGENTS.md` | ID, statement, one-clause why, gate | rule |
| Contract | `AGENTS.project.md` | Owns, Path, Never, Gate for one subsystem | rule |
| Practice | `agents/**` playbooks | advice with evidence (commit hashes), no ID | loses to rules |
| Fact | `agents/project/domain-context.md` | API quirk, platform behavior, failed approach, with hashes | loses to rules |

Rule IDs carry a tier letter: I invariants (never traded away), P process,
C code, M meta (govern the instruction files). Docs cite IDs, never
copied text, so a rule changes in one place.

## Contracts

A contract is four lines for one subsystem with one sanctioned path:

```
### HTTP
Owns: all network requests, including TLS handling.
Path: helpers in `src/lib/http.ts`.
Never: raw `fetch` or `axios`.
Gate: `tests/instruction-gate.test.ts` (no raw `fetch`/`axios`).
```

An agent reads it and learns, without opening source, who owns the
concern, the one way to use it, that a working bypass is still a bug,
and what will fail if it bypasses. `Gate: review` is allowed only when
no text search settles the Never clause.

## Gates

A gate fails a commit, a push, or a CI run. Kinds, cheapest first:

- **Grep gate**: a test that scans source for a forbidden pattern
  (`console.`, raw `fetch`, a static plugin import). Milliseconds.
- **Instruction gate**: a test over the instruction files themselves.
  Contract names exist in the tree, `AGENTS.md` has no project names,
  the always-loaded files stay under a word budget, cited commit hashes
  exist, no emails or IPs in knowledge files.
- **Ratchet**: a stored count that may fall or hold, never grow. For
  lint backlogs, mocks of internal modules, existence-only assertions,
  files over a length. Raising a number by hand needs a reason in the
  commit message.
- **Proven red**: CI runs the tests a range changed against the code
  from before the range, in a worktree at the fork point, and fails when
  they pass there. It says whether the red was an assertion failure or
  only a missing symbol.
- **Mutation smoke**: flip one branch in each of a few risky modules
  and require the module's tests to fail. The one check that proves
  existing tests can fail.
- **PR body check**: the body quotes the issue's acceptance lines; a
  `feat` PR names its spec or says why it has none.

Rule M2: read what a gate measured, not only its exit code. A job that
skips itself is green.

## Process rules that matter most

- P1 issue before work; PR quotes acceptance lines.
- P2 failing test before implementation; proven red enforces it.
- P3 run the gates covering a change before commit, all before push.
- P6 gates run as bare commands; output wrappers and compressors hid
  failures.
- P10 docs move with behavior.
- M1 a checkable rule needs a gate in the same change.
- M3 instruction files change only through the self-improvement
  protocol.
- M5 durable facts go to the domain playbook, not agent memory.

## Self-improvement protocol

Trigger: a breakage, a review finding, or a wasted session that a rule,
contract, or fact would have prevented. Action: the PR that fixes it
also proposes the instruction edit, with the gate M1 requires. The
maintainer merges or rejects it like any diff. Rules are removed the
same way when they cost more than they catch. The `refine` mode is the
periodic sweep for lessons nobody recorded at the time.

## Context budget

`AGENTS.md`, `AGENTS.project.md`, and `CLAUDE.md` load into every
session, so the instruction gate caps their combined words (start at
current count plus room; zmNinjaNg sits near 2,200 under a 4,000 cap).
Detail goes to playbooks, which load only for work in their area.
Instruction-following degrades with rule count, so every addition
answers: could a script check this instead?

## Review

Mechanical tasks rely on their gates. Judgment work gets a second agent
against the brief before the next task. Before a PR, one whole-branch
review on two axes in two contexts: Standards (the diff against
contracts and playbooks, skipping what a gate enforces) and Spec (the
diff against the acceptance lines). Findings stay under separate
headings; a change can pass one axis and fail the other.
