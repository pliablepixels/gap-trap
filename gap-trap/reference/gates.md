# Gates

Each gate below has a spec and reference implementations under
`templates/gates/`. Pick by stack:

| Stack | Instruction gate | Proven red | Ratchet |
|---|---|---|---|
| Node (vitest/jest) | `instruction-gate.test.ts` | `proven-red.mjs` | `ratchet.mjs` |
| Python (pytest) | `instruction_gate_test.py` | `proven-red.sh` with `python -m pytest "$@"` | `ratchet.sh` |
| Go, Rust, Java, Ruby, .NET, PHP, Swift, C++, anything else | `instruction-gate.sh` as a CI step and pre-commit hook, or a port into the runner | `proven-red.sh` with the runner in `run_tests` | `ratchet.sh` |

The `.sh` references need only git, grep, awk, and the repo's test
command, and were run against a Go repo and the origin TypeScript repo.
A native port into the runner is better when one is cheap (the gate then
runs with `npm test` or `pytest` and nobody forgets it); the shell gate
is the fallback that always works. Keep the same assertions and failure
messages whichever you pick. Every gate is proven red with a scratch
violation before it lands.

Unit test file patterns by stack, for the proven-red classifier and the
test-dir exemptions:

| Stack | Unit test files | Runs a subset by |
|---|---|---|
| Node | `*.test.ts`, `*.spec.ts`, `__tests__/` | file paths |
| Python | `test_*.py`, `*_test.py`, `tests/` | file paths |
| Go | `*_test.go` beside the source | package dirs (`go test ./pkg`) |
| Rust | `#[cfg(test)]` in source, `tests/*.rs` | `cargo test <name>`; whole crate is fine |
| Java/Kotlin | `*Test.java` under `src/test` | `-Dtest=Class` (Maven), `--tests` (Gradle) |
| Ruby | `*_spec.rb`, `spec/` | file paths |
| .NET | `*Tests.cs` | `--filter` |

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
   comments stripped, with the sanctioned file(s) exempt. The
   instruction gate holds only the clauses that are clean today (zero
   is the number). A clause with violations today goes into the ratchet
   as a count instead, so the backlog can fall but not grow and the
   instruction gate never carries an allowed number.

References: `templates/gates/instruction-gate.test.ts` (vitest),
`templates/gates/instruction_gate_test.py` (pytest),
`templates/gates/instruction-gate.sh` (any stack; config through `GT_*`
environment variables or the block at the top). The vitest port imports
`node:*` and uses `__dirname`; a repo whose type check covers the test
directory needs `@types/node` installed or the gate itself fails `tsc`.

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

References: `templates/gates/proven-red.mjs` (Node, reads the vitest
JSON report) and `templates/gates/proven-red.sh` (any stack, reads the
runner's text output with a cross-language missing-symbol pattern).
Adapt the three classifiers (unit test, test support, non-code) and the
`run_tests` command. CI job: `templates/gates/github-ci.yml`.

## Ratchet

Spec: a JSON baseline of named counts. The check fails when a count
grows, prints improvements when one falls, and fails when the baseline
sits more than a small slack above the real count (a raised number
nobody lowered back). `--update` rewrites the baseline.

The ratchet is always installed, because C2, C6, and C7 in `AGENTS.md`
name it as their gate. Seed it with what the repo supports: files over
the C2 length limit (always), lint problems per rule when a linter runs
(from its JSON output; ESLint's `max-lines` rule then covers C2 with no
new code), each contract Never clause that has violations today, test
files that mock the repo's own modules, assertions that only prove
existence, fixed sleeps in end-to-end steps.

References: `templates/gates/ratchet.mjs` (Node) and
`templates/gates/ratchet.sh` (any stack: counters are shell one-liners in
`.ratchet-counters`, the baseline is a text file).

## PR body check

Spec: a CI job on same-repo, non-bot PRs. Fails when `## Acceptance`
has no content after stripping HTML comments. On a `feat` title, fails
when `## Spec` has no content. The template is
`templates/pull_request_template.md`. The check lives in a script the
job calls, so it can be proven red locally with a body on stdin. The
title and body reach the script through environment variables, never
interpolated into the `run:` text (a PR title is attacker-controlled).

Reference: `templates/gates/pr-body-check.sh`, called by the
`pr-acceptance` job in `templates/gates/github-ci.yml`.
On GitLab the same shell reads `CI_MERGE_REQUEST_DESCRIPTION` and
`CI_MERGE_REQUEST_TITLE` in a `rules: - if: $CI_MERGE_REQUEST_IID` job.
The three CI jobs (gates, proven red, PR body) map one to one onto any
provider; only the checkout depth (full history for the hash check) and
the toolchain setup step change.

## Mutation smoke

Spec: a list of `{file, from, to, tests}`; for each, replace `from` with
`to`, run `tests`, require failure, restore the file whether or not the
run failed. Start with three or four risky modules (auth, the API
client, a parser). Runs in CI, about two seconds per target.

Reference: the pattern is short enough to write from the spec in any
language (`sed -i` the mutation, run the tests, `git checkout` the file
in a trap); see `app/scripts/mutation-smoke.mjs` in zmNinjaNg for one.

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
