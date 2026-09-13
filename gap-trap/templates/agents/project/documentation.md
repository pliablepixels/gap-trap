# Documentation playbook

Read before editing user or developer documentation.

## Scope

- User-visible behavior changes update `{{USER_DOCS}}`.
- New APIs, components, services, or traced paths update `{{DEV_DOCS}}`.
- A changed user-visible flow updates its call-flow trace. Add a trace only
  for a main journey not already covered.
- Developer docs teach a competent programmer who does not know this
  stack. Explain a framework mechanism where it first affects behavior.

## Style

- Write and edit with the slop-mop skill. The rules below add what it does
  not cover.
- Write like a developer explaining to a colleague. No headline-style
  headings ("The X", "A deep dive into Y") and no news-article cadence.
- Examples must grep-hit the codebase unless marked simplified. Cite
  symbols, never line numbers; line numbers rot within hours.
- Developer docs cite AGENTS.md rule IDs or AGENTS.project.md contract
  names instead of copying process rules.
- Reports and retrospectives are documentation; every rule above applies.
  Claims cite their commit, verified to exist before citing.
