#!/bin/sh
# Proven-red gate (AGENTS.md P2), language-neutral reference from gap-trap.
# Needs git and the repo's test command. For a range base..head it takes the
# unit test files changed since the fork point, runs each one in a worktree
# that holds the fork-point code plus the head tests, and fails when it passes
# there. A test that is green on the code it claims to guard proves nothing.
#
#   sh proven-red.sh <base> <head> [--title "<pr title>"]
#
# Each changed test file is run and judged on its own. One file that fails
# carries no proof for the others: a run that batched them together let a test
# which passed on the old code ride out on a failing sibling's exit status.
#
# It also reads the run's output twice. A red made only of missing symbols
# ("undefined:", "ImportError", "is not a function") proves the code is new,
# not that the assertions bite, and gets a warning instead of a pass line.
# And a non-zero status with no sign the runner ever started is not a red at
# all: it exits 2 rather than reporting a proof it did not observe.
#
# Exit codes: 0 proved or skipped, 1 a test proved nothing, 2 the gate could
# not run.
set -u

# ---- config ---------------------------------------------------------------
APP_DIR=${GT_APP_DIR:-.}                            # ADAPT: where the test command runs
# ADAPT: which changed paths are unit tests (proven), end-to-end tests (real
# tests that need a live server, so they skip with a warning), test support
# (travels along, never excuses a missing test), gate files (proven red by
# scratch violation), non-code (never a behavior change).
UNIT_TEST_RE=${GT_UNIT_TEST_RE:-'(_test\.go|_test\.py|/test_[^/]+\.py|\.test\.[jt]sx?|_spec\.rb|Test\.java|Tests?\.cs|_test\.rs)$'}
E2E_TEST_RE=${GT_E2E_TEST_RE:-'(^|/)(e2e|steps|features)/'}
TEST_SUPPORT_RE=${GT_TEST_SUPPORT_RE:-'(^|/)(tests?|__tests__|spec|testdata|fixtures)/|conftest\.py$|/setup\.(ts|js)$'}
GATE_FILE_RE=${GT_GATE_FILE_RE:-'^scripts/|instruction.gate|proven-red|ratchet'}
NON_CODE_RE=${GT_NON_CODE_RE:-'^(docs/|agents/|\.github/|\.githooks/|Makefile$|\.ratchet-|.*\.(md|rst|txt|yml|yaml)$|.*baseline.*\.json$)'}
SKIP_TYPES='docs chore ci refactor build style test'
# ADAPT: run one test file. Go tests run by package, so map the file to its dir.
run_tests() {   # $1 = one changed unit test path relative to APP_DIR
  go test "$(dirname "./$1")"
  # npx vitest run "$1"
  # python -m pytest "$1"
  # cargo test            # rust: cannot select by file; runs all
}
# Symptoms of a missing symbol rather than a wrong value, across runners.
# Matched against the whole run output.
MISSING_RE=${GT_MISSING_RE:-'undefined: |undefined \(type|has no field or method|is not a function|Cannot find module|Failed to resolve import|ImportError|ModuleNotFoundError|AttributeError|NameError|cannot find symbol|unresolved import|no required module provides package|cannot find package|undeclared name|is not defined|no member named|has no exported member'}
# Lines a runner prints as its own verdict, as opposed to source it echoed
# back. ASSERTION_RE is matched against these lines only: every pytest failure
# echoes the failing source line, so a bare `assert` over the whole output
# marked every missing-symbol red as an assertion red and the warning below
# could never fire.
VERDICT_RE=${GT_VERDICT_RE:-'^E[[:space:]]|^[[:space:]]*---[[:space:]]*FAIL|^[[:space:]]*FAILED[[:space:]]|^[[:space:]]*AssertionError|^[[:space:]]*AssertionFailedError|^[[:space:]]*Error:|panic:|^[[:space:]]*[0-9]+\)[[:space:]]'}
ASSERTION_RE=${GT_ASSERTION_RE:-'AssertionError|AssertionFailedError|assertion failed|--- FAIL|panic:|assert|expected|Expected'}
# Evidence the runner started at all. A non-zero status without it is a broken
# command or a broken worktree, not a test going red.
RAN_RE=${GT_RAN_RE:-'--- FAIL|--- PASS|^ok[[:space:]]|^FAIL|^PASS|build failed|setup failed|Test Files|Tests[[:space:]]|passed|failed|error|no test files|Ran [0-9]+ test'}
# ---- end config -----------------------------------------------------------

base=$1; head=$2; shift 2
title=''
[ "${1:-}" = "--title" ] && title=${2:-}
[ -n "$title" ] || title=$(git log -1 --format=%s "$head")

fork=$(git merge-base "$base" "$head") || { echo "proven-red: no merge base for $base..$head"; exit 2; }
files=$(git diff --name-only "$fork..$head")
# A test deleted at head cannot be proven, and must not be run: the worktree
# still holds its old copy, which passes and reads as a test that proves
# nothing. Deletions still count as a source change below.
live=$(git diff --name-only --diff-filter=d "$fork..$head")

unit=$(printf '%s\n' "$live" | grep -E -- "$UNIT_TEST_RE" || true)
e2e=$(printf '%s\n' "$live" | grep -E -- "$E2E_TEST_RE" | grep -vE -- "$UNIT_TEST_RE" || true)
source_files=$(printf '%s\n' "$files" | grep -vE -- "$UNIT_TEST_RE" | grep -vE -- "$E2E_TEST_RE" | grep -vE -- "$TEST_SUPPORT_RE" | grep -vE -- "$NON_CODE_RE" || true)
support=$(printf '%s\n' "$live" | grep -E -- "$TEST_SUPPORT_RE" | grep -vE -- "$UNIT_TEST_RE" | grep -vE -- "$E2E_TEST_RE" || true)

warn_skip() {   # $1 = reason. A skip that is a bypass rather than a proof.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::warning title=Proven red skipped::proven-red: skipped, $1."
  else
    echo "proven-red: skipped, $1."
  fi
  exit 0
}

if [ -z "$source_files" ]; then echo "proven-red: skipped, no source file changed."; exit 0; fi
if [ -z "$unit" ]; then
  # Only gate files changed: those are proven red by scratch violation.
  if [ -z "$(printf '%s\n' "$source_files" | grep -vE -- "$GATE_FILE_RE" || true)" ]; then
    echo "proven-red: skipped, only gate files changed; a gate is proven red by scratch violation."
    exit 0
  fi
  # The title is unverified text, so this skip is announced as a bypass.
  type=$(printf '%s' "$title" | sed -nE 's/^([a-z]+)(\(.+\))?!?:.*/\1/p')
  for t in $SKIP_TYPES; do
    [ "$type" = "$t" ] && warn_skip "title type \"$type\" carries no behavior change"
  done
  [ -n "$e2e" ] && warn_skip "the only changed tests are end-to-end, which need a live server"
  echo "proven-red: a behavior change arrived with no changed test (P2)."; exit 1
fi

worktree=$(mktemp -d "${TMPDIR:-/tmp}/proven-red-XXXXXX") || { echo "proven-red: cannot make a worktree dir"; exit 2; }
trap 'git worktree remove --force "$worktree" 2>/dev/null || rm -rf "$worktree"' EXIT
git worktree add --detach -q "$worktree" "$fork" || { echo "proven-red: git worktree add failed; the gate cannot run."; exit 2; }
# Read the head versions from git, not the working tree: locally the checkout
# may be on another branch, and a test copied from there proves nothing.
for f in $unit $support; do
  mkdir -p "$worktree/$(dirname "$f")" || { echo "proven-red: cannot write $f into the worktree"; exit 2; }
  git show "$head:$f" > "$worktree/$f" || { echo "proven-red: cannot read $head:$f"; exit 2; }
done
# ADAPT: share installed dependencies with the worktree instead of reinstalling.
mkdir -p "$worktree/$APP_DIR"
for d in node_modules .venv vendor; do
  [ -e "$APP_DIR/$d" ] && ln -s "$(cd "$APP_DIR" && pwd)/$d" "$worktree/$APP_DIR/$d"
done

green=''
missing_only=''
sample=''
for f in $unit; do
  # Prefix removal, not sed: APP_DIR goes into a regex there, and the common
  # value "." matches any character, so "a/b.test.js" lost its first segment.
  rel=${f#"$APP_DIR"/}
  out=$(cd "$worktree/$APP_DIR" && run_tests "$rel" 2>&1); code=$?
  echo "--- $rel ---"
  printf '%s\n' "$out"
  if [ "$code" -eq 0 ]; then
    green="$green $rel"
    continue
  fi
  case "$code" in
    126|127) echo "proven-red: the test command could not be run for $rel (exit $code)."; exit 2 ;;
  esac
  if [ "$code" -gt 128 ]; then echo "proven-red: the test command was killed for $rel (exit $code)."; exit 2; fi
  if ! printf '%s\n' "$out" | grep -qE -- "$RAN_RE"; then
    echo "proven-red: the test command exited $code for $rel with no sign it ran. That is a broken command or worktree, not a test going red."
    exit 2
  fi
  verdicts=$(printf '%s\n' "$out" | grep -E -- "$VERDICT_RE" || true)
  if printf '%s\n' "$out" | grep -qE -- "$MISSING_RE" && ! printf '%s\n' "$verdicts" | grep -qE -- "$ASSERTION_RE"; then
    missing_only="$missing_only $rel"
    [ -n "$sample" ] || sample=$(printf '%s\n' "$out" | grep -E -- "$MISSING_RE" | head -1)
  fi
done

if [ -n "$green" ]; then
  echo "proven-red: these changed test files pass on the pre-change code; they cannot catch the bug they claim to:$green"
  exit 1
fi
if [ -n "$missing_only" ]; then
  msg="proven-red: these files fail on the pre-change code only because they reference code it does not have, e.g. \"$sample\":$missing_only. That proves the code is new, not that the assertions would catch a wrong value. Check those assertions in review, or add the module to the mutation smoke."
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::warning title=Red by missing symbol only::$msg"
  else
    echo "$msg"
  fi
fi
echo "proven-red: changed tests fail on the pre-change code, as they should."
exit 0
