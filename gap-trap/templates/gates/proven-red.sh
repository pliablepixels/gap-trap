#!/bin/sh
# Proven-red gate (AGENTS.md P2), language-neutral reference from gap-trap.
# Needs git and the repo's test command. For a range base..head it takes the
# unit test files changed since the fork point, runs them in a worktree that
# holds the fork-point code plus the head tests, and fails when they pass
# there. A test that is green on the code it claims to guard proves nothing.
#
#   sh proven-red.sh <base> <head> [--title "<pr title>"]
#
# It also reads the run's output: a red made only of missing symbols
# ("undefined:", "ImportError", "is not a function") proves the code is new,
# not that the assertions bite, and gets a warning instead of a pass line.
set -u

# ---- config ---------------------------------------------------------------
APP_DIR=${GT_APP_DIR:-.}                            # ADAPT: where the test command runs
# ADAPT: which changed paths are unit tests, test support (travels along, not proven), non-code.
UNIT_TEST_RE=${GT_UNIT_TEST_RE:-'(_test\.go|_test\.py|/test_[^/]+\.py|\.test\.[jt]sx?|_spec\.rb|Test\.java|Tests?\.cs|_test\.rs)$'}
TEST_SUPPORT_RE=${GT_TEST_SUPPORT_RE:-'(^|/)(tests?|__tests__|spec|testdata|fixtures)/|conftest\.py$|/setup\.(ts|js)$|^scripts/'}
NON_CODE_RE=${GT_NON_CODE_RE:-'^(docs/|agents/|\.github/|\.githooks/|Makefile$|\.ratchet-|.*\.(md|rst|txt|yml|yaml)$|.*baseline.*\.json$)'}
SKIP_TYPES='docs chore ci refactor build style test'
# ADAPT: run only the given test files. Go tests run by package, so map files to dirs.
run_tests() {   # $@ = changed unit test paths relative to APP_DIR
  go test $(for f in "$@"; do dirname "./$f"; done | sort -u)
  # npx vitest run "$@"
  # python -m pytest "$@"
  # cargo test            # rust: cannot select by file; runs all
}
# Symptoms of a missing symbol rather than a wrong value, across runners.
MISSING_RE='undefined: |is not a function|Cannot find module|ImportError|ModuleNotFoundError|AttributeError: module|NameError|cannot find symbol|unresolved import|is not defined|no member named'
ASSERTION_RE='AssertionError|assert|expected|Expected|--- FAIL|assertion failed|panic:'
# ---- end config -----------------------------------------------------------

base=$1; head=$2; shift 2
title=''
[ "${1:-}" = "--title" ] && title=$2
[ -n "$title" ] || title=$(git log -1 --format=%s "$head")

fork=$(git merge-base "$base" "$head") || { echo "proven-red: no merge base for $base..$head"; exit 2; }
files=$(git diff --name-only "$fork..$head")
unit=$(printf '%s\n' "$files" | grep -E "$UNIT_TEST_RE" || true)
support=$(printf '%s\n' "$files" | grep -E "$TEST_SUPPORT_RE" | grep -vE "$UNIT_TEST_RE" || true)
source=$(printf '%s\n' "$files" | grep -vE "$UNIT_TEST_RE" | grep -vE "$TEST_SUPPORT_RE" | grep -vE "$NON_CODE_RE" || true)

if [ -z "$source" ]; then echo "proven-red: skipped, no source file changed."; exit 0; fi
if [ -z "$unit" ]; then
  type=$(printf '%s' "$title" | sed -nE 's/^([a-z]+)(\(.+\))?!?:.*/\1/p')
  for t in $SKIP_TYPES; do
    [ "$type" = "$t" ] && { echo "proven-red: skipped, title type \"$type\" carries no behavior change."; exit 0; }
  done
  if [ -n "$support" ]; then echo "proven-red: skipped, only test-support or gate files changed; gates are proven red by scratch violation."; exit 0; fi
  echo "proven-red: a behavior change arrived with no changed test (P2)."; exit 1
fi

worktree=$(mktemp -d "${TMPDIR:-/tmp}/proven-red-XXXXXX")
trap 'git worktree remove --force "$worktree" 2>/dev/null || rm -rf "$worktree"' EXIT
git worktree add --detach -q "$worktree" "$fork"
# Read the head versions from git, not the working tree: locally the checkout
# may be on another branch, and a test copied from there proves nothing.
for f in $unit $support; do
  git cat-file -e "$head:$f" 2>/dev/null || continue   # deleted at head
  mkdir -p "$worktree/$(dirname "$f")" && git show "$head:$f" > "$worktree/$f"
done
# ADAPT: share installed dependencies with the worktree instead of reinstalling.
for d in node_modules .venv vendor; do
  [ -e "$APP_DIR/$d" ] && ln -s "$(cd "$APP_DIR" && pwd)/$d" "$worktree/$APP_DIR/$d"
done

relative=$(printf '%s\n' "$unit" | sed "s|^$APP_DIR/||")
out=$(cd "$worktree/$APP_DIR" && run_tests $relative 2>&1); code=$?
printf '%s\n' "$out"
if [ "$code" -eq 0 ]; then
  echo "proven-red: $(printf '%s\n' "$unit" | grep -c .) changed test file(s) pass on the pre-change code; they cannot catch the bug they claim to."
  exit 1
fi
if printf '%s\n' "$out" | grep -qE "$MISSING_RE" && ! printf '%s\n' "$out" | grep -qE "$ASSERTION_RE"; then
  msg="proven-red: the changed tests fail on the pre-change code only because they reference code it does not have. That proves the code is new, not that the assertions would catch a wrong value. Check the assertions in review, or add the module to the mutation smoke."
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::warning title=Red by missing symbol only::$msg" || echo "$msg"
  exit 0
fi
echo "proven-red: changed tests fail on the pre-change code, as they should."
exit 0
