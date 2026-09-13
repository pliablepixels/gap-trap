# {{PROJECT}} Project Instructions

Read `AGENTS.md` first. Contracts, project rules, verification, playbooks.
The sanctioned path is the only path; a bypass is a bug even when it works.

## Architecture contracts

<!-- One block per subsystem with one sanctioned path. Real symbol names
only; the instruction gate greps every backticked token in Path and Gate.
`Gate: review` only when no text search settles the Never clause. -->

### {{CONTRACT_NAME}}
Owns: {{what this subsystem owns}}.
Path: `{{sanctionedSymbol}}` (`{{path/to/module}}`).
Never: {{the bypasses that count as bugs even when they work}}.
Gate: `{{path/to/instruction-gate}}` ({{what it greps}}); the ratchet holds {{counter name}}; review for the rest.

## Project rules

- Run commands from `{{WORKDIR}}`. Run `{{HOOK_INSTALL}}` once per clone so the pre-commit gates exist.
- Prose people read (docs, commit bodies, PR and issue bodies, review
  comments) is written with the slop-mop skill; prose reviews run its
  detect mode on Opus or newer.
- UI changes that alter behavior or navigation need an outcome-based
  end-to-end test; cosmetic changes rely on existing gates.
- A `feat` PR links its spec or says in its `## Spec` section why it
  needs none. Gate: the `pr-acceptance` CI job.
- GitHub comments by an agent end with `Posted by <agent>, assisting
  @<login>.` where `<login>` comes from `gh api user --jq .login`.

## Verification

```
{{GATES_CMD}}            # unit tests, build or type check, blocking lints
{{TEST_CMD}}
{{LINT_CMD}}
```

Per commit, run what the change touches; the full set before push or PR.
Ratchet baselines lower with `{{RATCHET_CMD}} --update`; raising one needs
a reason in the commit message (C7). CI also runs proven red (P2) and
`pr-acceptance` (PR body needs `## Acceptance` content, and `## Spec` on a
`feat`). State completed checks in handoff.

## Playbooks

Read each listed playbook before work in that area.

| Work | Read first |
|---|---|
| Naming, briefs, docs, proposing work | `agents/project/glossary.md`, `agents/project/out-of-scope.md` |
| Tests, UI, or platform checks | `agents/project/testing.md` |
| Developer or user documentation | `agents/project/documentation.md` |
| {{DOMAIN}} APIs and quirks | `agents/project/domain-context.md` |

Portable playbooks live in `agents/generic/`; project ones in
`agents/project/`.
