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
`github-ci.yml` is written for Node; on another stack replace the
setup-node and `npm` steps with the toolchain's (`actions/setup-go`,
`actions/setup-python`, `dtolnay/rust-toolchain`) and call the `.sh`
gates through the Makefile.
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

Spec (one test file, runs with the unit tests). In `Path:` and `Gate:`
lines, backtick only what the gate can look up: a file path (contains
`/`) or a bare symbol found as a whole word in the source tree. A
counter name, a dotted call such as `log.Print`, or a flag goes
unquoted. The minimum contract count is the honest number, two is
fine; never pad. Cite commit hashes with at least 7 characters (`git
log --oneline` prints 7) and the gate resolves them.

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
   `out-of-scope.md`, `agent-workflows.md`) contain no email or IP
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

## Combined gate command and hooks

Add one command that runs the unit tests, the build or type check, the
blocking lints, the instruction gate, and the ratchet, so P3 has a name
to cite: `npm run gates` on Node, a `gates` target in a `Makefile`
everywhere else (Python, Go, Rust, Java all read a Makefile). Cost it:
the origin repo's runs in about a minute locally.

Pre-commit: Node repos use husky; every other stack gets a versioned
`.githooks/pre-commit` that runs the instruction gate and the ratchet,
enabled once per clone with `git config core.hooksPath .githooks`. The
project rules name that command so an agent runs it on a fresh clone.
CI re-runs the same gates, so a skipped hook changes nothing that
merges.

No CI provider yet: write the GitHub Actions workflow when the remote is
GitHub or there is no remote (it is the reference and costs nothing
unused), and say in the report that no CI runs until the repo is
pushed there. A GitLab remote gets the three jobs as `.gitlab-ci.yml`.

## What not to add

- Coverage thresholds nothing on a PR runs. A ratchet on what tests
  catch beats a percentage.
- A second run of the same linter (an advisory pass beside a ratchet).
- Any gate whose input you have not read once. A gate that scans
  nothing is green (M2); assert the file count it scanned.
- A pass-branch for a known red. A gate that reads the failure text and
  succeeds on a match (`if output includes "Environment variable not
  found: DATABASE_URL" then pass`) exempts every future failure that
  prints the same string, including the one it was built to catch. A
  red that stays for now is a ratchet count or an out-of-scope entry,
  recorded outside the gate, and the gate keeps failing on it.
