# Gates

Each gate below has a spec and a reference implementation under
`templates/gates/`. The references are Node and vitest because the
origin repo is; port the spec to the repo's own test runner and keep the
same assertions and failure messages. One reference is enough to port
from. Every gate is proven red with a scratch violation before it lands.

## Instruction gate

Spec (one test file, runs with the unit tests):

1. `AGENTS.project.md` has at least N contracts and each has `Owns:`,
   `Path:`, `Never:`, `Gate:` lines.
2. Every backticked token in a `Path:` or `Gate:` line exists: a token
   with `/` is a file path; any other is a word found in the source
   tree. Failure names the contract and the token.
3. `AGENTS.md` contains none of a list of project-specific tokens
   (product name, framework names, file paths). Fill the list from
   discovery.
4. `AGENTS.md` + `AGENTS.project.md` + `CLAUDE.md` stay under a word
   budget. Set it at current count plus room; raising it needs a
   reason in the commit message.
5. Every 8-hex commit hash cited in `domain-context.md` exists
   (`git cat-file -e <hash>^{commit}`; CI needs full history).
6. Knowledge files (`domain-context.md`, `glossary.md`,
   `out-of-scope.md`, `claude-workflows.md`) contain no email or IP
   address.
7. Every `rule <ID>` cited in the developer docs exists in `AGENTS.md`.
8. Grep gates for each contract Never clause a text search settles,
   comments stripped, with the sanctioned file(s) exempt. Zero hits is
   the number when the tree is clean today; a ratchet count when it is
   not.

Reference: `templates/gates/instruction-gate.test.ts`.

## Proven red

Spec: for a PR range, take the unit test files changed since the fork
point, copy them into a worktree at the fork point, run them there, fail
when they pass. Skip and say why when no source changed, or when the
title type is `docs|chore|ci|refactor|build|style|test` and no unit test
changed. Fail when source changed and no test did. Read the runner's
JSON report: count assertion failures and missing references (`is not a
function`, `Cannot find module`) apart, print both, warn when every
failure is a missing reference. Repo-hygiene tests (the instruction
gate) are exempt: they are proven red by scratch violation.

Reference: `templates/gates/proven-red.mjs`. Adapt the three regexes
(unit test, test support, non-code) and the test command. CI job:
`templates/gates/github-ci.yml`.

## Ratchet

Spec: a JSON baseline of named counts. The check fails when a count
grows, prints improvements when one falls, and fails when the baseline
sits more than a small slack above the real count (a raised number
nobody lowered back). `--update` rewrites the baseline.

Counters worth starting with: lint problems per rule (from the linter's
JSON output), test files that mock the repo's own modules, assertions
that only prove existence, files over a length limit (the linter's
max-lines rule feeds the lint ratchet with no new code), fixed sleeps in
end-to-end steps.

Reference: `templates/gates/ratchet.mjs`.

## PR body check

Spec: a CI job on same-repo, non-bot PRs. Fails when `## Acceptance`
has no content after stripping HTML comments. On a `feat` title, fails
when `## Spec` has no content. The template is
`templates/pull_request_template.md`.

Reference: the `pr-acceptance` job in `templates/gates/github-ci.yml`.

## Mutation smoke

Spec: a list of `{file, from, to, tests}`; for each, replace `from` with
`to`, run `tests`, require failure, restore the file whether or not the
run failed. Start with three or four risky modules (auth, the API
client, a parser). Runs in CI, about two seconds per target.

Reference: the pattern is short enough to write from the spec; see
`app/scripts/mutation-smoke.mjs` in zmNinjaNg for one.

## Combined gate command

Add one command that runs the unit tests, the build or type check, and
the blocking lints, so P3 has a name to cite. Cost it: the origin repo's
runs in about a minute locally.

## What not to add

- Coverage thresholds nothing on a PR runs. A ratchet on what tests
  catch beats a percentage.
- A second run of the same linter (an advisory pass beside a ratchet).
- Any gate whose input you have not read once. A gate that scans
  nothing is green (M2); assert the file count it scanned.
