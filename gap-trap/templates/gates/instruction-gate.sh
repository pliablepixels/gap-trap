#!/bin/sh
# Instruction gate, language-neutral reference from gap-trap. Needs git,
# grep, awk, wc. Run from the repo root as a CI step and a pre-commit hook
# when the repo's test runner has no native port (see gates.md).
#
# Checks: contracts parse and every name they cite exists where the contract
# says it lives; AGENTS.md holds no project tokens; the always-loaded files
# all exist and stay under the word budget; cited commit hashes exist;
# knowledge files hold no email or IP; docs cite rule IDs that exist; and the
# grep gates below (contract Never clauses a text search settles). Exit 1
# with every failure listed.
#
# Every check also asserts its own denominator: how many tokens it resolved,
# how many files it scanned. A check that quietly measures nothing reports
# the same green as one that measured everything (M2).
set -u

# ---- config ---------------------------------------------------------------
SRC_DIR=${GT_SRC_DIR:-src}                 # ADAPT: source tree contracts name
SOURCE_EXT=${GT_SOURCE_EXT:-'\.(go|py|rs|ts|tsx|js|java|kt|rb|swift|cs|php)$'}
TEST_PATH_RE=${GT_TEST_PATH_RE:-'(^|/)(__tests__|tests?|spec)(/|$)|_test\.|\.test\.|^test_|Test\.'}
# ADAPT. SRC_DIR is in the list because the portable core must not name the
# project's own source tree.
FORBIDDEN_IN_CORE=${GT_FORBIDDEN_IN_CORE:-"{{PRODUCT}} {{FRAMEWORK}} agents/project $SRC_DIR"}
WORD_BUDGET=${GT_WORD_BUDGET:-4000}         # ADAPT: current count plus room (C7)
MIN_CONTRACTS=${GT_MIN_CONTRACTS:-2}       # the honest count; never pad
ALWAYS_LOADED=${GT_ALWAYS_LOADED:-'AGENTS.md AGENTS.project.md CLAUDE.md'}
KNOWLEDGE_FILES='agents/project/domain-context.md agents/project/glossary.md agents/project/out-of-scope.md agents/generic/agent-workflows.md'
DOCS_DIR=${GT_DOCS_DIR:-docs}               # ADAPT: '' skips the rule-ID check
# ADAPT: one grep gate per printf row: name, ERE over source lines, ERE over
# relative paths to exempt. Fields are tab-separated so patterns may use `|`.
# Only clauses that are clean today belong here; a clause with violations
# goes into .ratchet-counters as a count (gates.md, instruction gate item 8).
TAB=$(printf '\t')
GREP_GATES=$(printf '%s\t%s\t%s\n' \
  'Logging: no raw print or console outside the logger' '\bconsole\.[a-z]+\(|\bfmt\.Print|\blog\.Print|\bprint\(' '^lib/log|^logx/' \
  'HTTP: no raw HTTP client outside the wrapper' '[^.A-Za-z_]fetch\(|\bhttp\.(Get|Post|NewRequest|DefaultClient)\b|\brequests\.(get|post)\(' '^lib/http|^httpx/' \
)
# ---- end config -----------------------------------------------------------

fail=0
bad() { echo "FAIL: $*"; fail=1; }

# Fold a contract body's wrapped lines back into the field they continue.
# Markdown prose wraps, and a Path: line long enough to wrap used to have
# everything past the wrap silently dropped from the check.
fold_fields() {
  awk '
    /^[[:space:]]*(Owns|Path|Never|Gate):/ {
      if (buf != "") print buf
      buf = $0; sub(/^[[:space:]]+/, "", buf); next
    }
    /^[[:space:]]*$/ { if (buf != "") { print buf; buf = "" } next }
    { if (buf != "") { line = $0; sub(/^[[:space:]]+/, "", line); buf = buf " " line } }
    END { if (buf != "") print buf }
  '
}

src_files=$(git ls-files "$SRC_DIR" 2>/dev/null | grep -E -- "$SOURCE_EXT" || true)
nontest_files=$(printf '%s\n' "$src_files" | grep -vE -- "$TEST_PATH_RE" || true)

# A contract symbol found only in a test file is not a symbol the code uses,
# so the fallback haystack is the non-test source only.
# ponytail: word-split file list, so paths with spaces are missed. Switch to
# `grep -r` over a directory if a repo has them.
symbol_in_nontest_source() {
  [ -n "$nontest_files" ] || return 1
  # shellcheck disable=SC2086
  grep -qw -- "$1" $nontest_files 2>/dev/null
}
symbol_in_paths() {
  token=$1; shift
  for p in "$@"; do
    [ -e "$p" ] || continue
    grep -rqw --exclude-dir=node_modules --exclude-dir=.git -- "$token" "$p" 2>/dev/null && return 0
  done
  return 1
}

# 1. contracts parse
contracts=$(awk '/^## Architecture contracts/{f=1;next} /^## /{f=0} f' AGENTS.project.md)
names=$(printf '%s\n' "$contracts" | grep -E '^### ' | sed 's/^### //')
count=$(printf '%s\n' "$names" | grep -c .)
[ "$count" -ge "$MIN_CONTRACTS" ] || bad "only $count contracts, need $MIN_CONTRACTS"

# 2. every backticked token in Path/Gate lines exists where the contract says
resolve_symbol() {   # $1 = token, $2 = contract name, $3 = the folded line, $4 = path tokens
  token=$1; cname=$2; cline=$3; cpaths=$4
  # A Path line names where the subsystem lives, so its symbols are looked for
  # there. Resolving them anywhere in the tree let a symbol that had moved out
  # of its own module keep the contract green.
  if [ -n "$cpaths" ]; then
    case "$cline" in
      Path:*)
        # shellcheck disable=SC2086
        symbol_in_paths "$token" $cpaths && return 0
        echo "FAIL: $cname: symbol $token not found in $(printf '%s' "$cpaths" | tr '\n' ' ')"
        return 0
        ;;
    esac
  fi
  symbol_in_nontest_source "$token" || echo "FAIL: $cname: symbol $token not found in $SRC_DIR (non-test files)"
}

check_contracts() {
  printf '%s\n' "$names" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    block=$(printf '%s\n' "$contracts" | awk -v n="### $name" '$0==n{f=1;next} /^### /{f=0} f' | fold_fields)
    for field in Owns: Path: Never: Gate:; do
      printf '%s\n' "$block" | grep -q "^$field" || echo "FAIL: contract $name missing $field"
    done
    printf '%s\n' "$block" | grep -E '^(Path|Gate):' | while IFS= read -r line; do
      tokens=$(printf '%s\n' "$line" | grep -o '`[^`]*`' | tr -d '`' | sed 's/()$//' | sort -u)
      paths=$(printf '%s\n' "$tokens" | grep '/' || true)
      symbols=$(printf '%s\n' "$tokens" | grep -v '/' | grep -v '^$' || true)
      for token in $paths; do
        [ -e "$token" ] || echo "FAIL: $name: path $token missing"
        echo "CHECKED $name"
      done
      for token in $symbols; do
        resolve_symbol "$token" "$name" "$line" "$paths"
        echo "CHECKED $name"
      done
    done
  done
}

contract_report=$(check_contracts)
printf '%s\n' "$contract_report" | grep -v '^CHECKED ' | grep -v '^$' || true
tokens_checked=$(printf '%s\n' "$contract_report" | grep -c '^CHECKED ')
# Per contract as well as overall: one contract that cites real names must not
# cover for a neighbour that cites nothing the gate can look up.
denominator_report=$(printf '%s\n' "$names" | while IFS= read -r name; do
  [ -n "$name" ] || continue
  printf '%s\n' "$contract_report" | grep -qx -- "CHECKED $name" ||
    echo "FAIL: contract $name: its Path/Gate lines name nothing the gate can check"
done)
[ -z "$denominator_report" ] || { printf '%s\n' "$denominator_report"; fail=1; }
# No overall "did anything get checked" line here: a contracts section this
# script cannot parse yields no names, which fails the MIN_CONTRACTS check
# above before it could matter. The count still goes in the summary (M2).
case "$contract_report" in *FAIL*) fail=1 ;; esac

# 3. portable core
for token in $FORBIDDEN_IN_CORE; do
  grep -qi -- "$token" AGENTS.md && bad "AGENTS.md contains \"$token\""
done

# 4. word budget. Every always-loaded file has to be there: summing whatever
# happens to exist means deleting one reads as coming in under budget.
missing=''
for f in $ALWAYS_LOADED; do
  [ -f "$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  bad "always-loaded file(s) missing:$missing; the budget would fall for free"
  words=0
else
  # shellcheck disable=SC2086
  words=$(cat $ALWAYS_LOADED | wc -w | tr -d ' ')
  [ "$words" -le "$WORD_BUDGET" ] || bad "always-loaded files are $words words, budget $WORD_BUDGET"
fi

# 5. cited hashes exist
if [ -f agents/project/domain-context.md ]; then
  # 7 to 40 hex chars with at least one digit: --oneline prints 7, and the
  # digit keeps English words made of a-f (acceded, defaced) out.
  for h in $(grep -oE '\b[0-9a-f]{7,40}\b' agents/project/domain-context.md | grep '[0-9]' | sort -u); do
    git cat-file -e "$h^{commit}" 2>/dev/null || bad "cited commit $h not found in history"
  done
fi

# 6. no private data in knowledge files. The domain needs a letter TLD, or a
# pinned version such as `vitest@1.2.3` reads as an email and the gate cries wolf.
for f in $KNOWLEDGE_FILES; do
  [ -f "$f" ] || continue
  grep -qE '\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b' "$f" && bad "$f contains an IP address"
  grep -qE '\b[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b' "$f" && bad "$f contains an email address"
done

# 7. docs cite rule IDs that exist
if [ -n "$DOCS_DIR" ] && [ -d "$DOCS_DIR" ]; then
  valid=$(grep -oE '^- [IPCM][0-9]+\.' AGENTS.md | sed 's/[-. ]//g')
  rules_report=$(grep -rhoiE '\brules? [IPCM][0-9]+\b' "$DOCS_DIR" | awk '{print toupper($2)}' | sort -u | while IFS= read -r id; do
    [ -n "$id" ] || continue
    printf '%s\n' "$valid" | grep -qx -- "$id" || echo "FAIL: docs cite unknown rule $id"
  done)
  [ -z "$rules_report" ] || { printf '%s\n' "$rules_report"; fail=1; }
fi

# 8. grep gates over non-test source, comment lines dropped
[ -d "$SRC_DIR" ] || bad "SRC_DIR $SRC_DIR does not exist"
scanned=$(printf '%s\n' "$nontest_files" | grep -c .)
[ "$scanned" -gt 0 ] || bad "grep gates scanned no source files under $SRC_DIR (M2)"
# ponytail: comment lines are dropped line by line, so a violation commented
# out inside a /* ... */ block still reads as a violation. Loud, not silent;
# the native ports use a real scanner.
grep_report=$(printf '%s\n' "$GREP_GATES" | grep -v '^$' | while IFS="$TAB" read -r name pattern exempt; do
  hits=''
  for f in $nontest_files; do
    rel=${f#"$SRC_DIR"/}
    [ -n "$exempt" ] && printf '%s\n' "$rel" | grep -qE -- "$exempt" && continue
    grep -vE '^[[:space:]]*(//|#|\*|/\*|--)' "$f" | grep -qE -- "$pattern" && hits="$hits $rel"
  done
  [ -z "$hits" ] || echo "FAIL: $name:$hits"
done)
[ -z "$grep_report" ] || { printf '%s\n' "$grep_report"; fail=1; }

[ "$fail" -eq 0 ] && echo "instruction gate: ok ($count contracts, $tokens_checked cited names, $scanned source files, $words words)"
exit $fail
