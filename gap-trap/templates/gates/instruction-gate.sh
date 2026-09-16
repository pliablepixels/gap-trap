#!/bin/sh
# Instruction gate, language-neutral reference from gap-trap. Needs git,
# grep, awk, wc. Run from the repo root as a CI step and a pre-commit hook
# when the repo's test runner has no native port (see gates.md).
#
# Checks: contracts parse and every name they cite exists; AGENTS.md holds
# no project tokens; the always-loaded files stay under the word budget;
# cited commit hashes exist; knowledge files hold no email or IP; docs cite
# rule IDs that exist; and the grep gates below (contract Never clauses a
# text search settles). Exit 1 with every failure listed.
set -u

# ---- config ---------------------------------------------------------------
SRC_DIR=${GT_SRC_DIR:-src}                 # ADAPT: source tree contracts name
SOURCE_EXT=${GT_SOURCE_EXT:-'\.(go|py|rs|ts|tsx|js|java|kt|rb|swift|cs|php)$'}
TEST_PATH_RE=${GT_TEST_PATH_RE:-'(^|/)(__tests__|tests?|spec)(/|$)|_test\.|\.test\.|^test_|Test\.'}
FORBIDDEN_IN_CORE=${GT_FORBIDDEN_IN_CORE:-'{{PRODUCT}} {{FRAMEWORK}} agents/project'}  # ADAPT
WORD_BUDGET=${GT_WORD_BUDGET:-4000}         # ADAPT: current count plus room (C7)
MIN_CONTRACTS=${GT_MIN_CONTRACTS:-2}       # the honest count; never pad
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

# 1. contracts parse
contracts=$(awk '/^## Architecture contracts/{f=1;next} /^## /{f=0} f' AGENTS.project.md)
names=$(printf '%s\n' "$contracts" | grep -E '^### ' | sed 's/^### //')
count=$(printf '%s\n' "$names" | grep -c .)
[ "$count" -ge "$MIN_CONTRACTS" ] || bad "only $count contracts, need $MIN_CONTRACTS"
printf '%s\n' "$names" | while IFS= read -r name; do
  [ -n "$name" ] || continue
  block=$(printf '%s\n' "$contracts" | awk -v n="### $name" '$0==n{f=1;next} /^### /{f=0} f')
  for field in Owns: Path: Never: Gate:; do
    printf '%s\n' "$block" | grep -q "^$field" || echo "FAIL: contract $name missing $field"
  done
  # 2. every backticked token in Path/Gate lines exists
  printf '%s\n' "$block" | grep -E '^(Path|Gate):' | grep -o '`[^`]*`' | tr -d '`' | sed 's/()$//' | sort -u | while IFS= read -r token; do
    case "$token" in
      */*) [ -e "$token" ] || echo "FAIL: $name: path $token missing" ;;
      *) grep -rqw --exclude-dir=node_modules --exclude-dir=.git -- "$token" "$SRC_DIR" 2>/dev/null || echo "FAIL: $name: symbol $token not found in $SRC_DIR" ;;
    esac
  done
done | tee /tmp/gt-contracts.$$ ; grep -q FAIL /tmp/gt-contracts.$$ && fail=1; rm -f /tmp/gt-contracts.$$

# 3. portable core
for token in $FORBIDDEN_IN_CORE; do
  grep -qi -- "$token" AGENTS.md && bad "AGENTS.md contains \"$token\""
done

# 4. word budget
words=$(cat AGENTS.md AGENTS.project.md CLAUDE.md 2>/dev/null | wc -w | tr -d ' ')
[ "$words" -le "$WORD_BUDGET" ] || bad "always-loaded files are $words words, budget $WORD_BUDGET"

# 5. cited hashes exist
if [ -f agents/project/domain-context.md ]; then
  # 7 to 40 hex chars with at least one digit: --oneline prints 7, and the
  # digit keeps English words made of a-f (acceded, defaced) out.
  for h in $(grep -oE '\b[0-9a-f]{7,40}\b' agents/project/domain-context.md | grep '[0-9]' | sort -u); do
    git cat-file -e "$h^{commit}" 2>/dev/null || bad "cited commit $h not found in history"
  done
fi

# 6. no private data in knowledge files
for f in $KNOWLEDGE_FILES; do
  [ -f "$f" ] || continue
  grep -qE '\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b' "$f" && bad "$f contains an IP address"
  grep -qE '\b[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.]+\b' "$f" && bad "$f contains an email address"
done

# 7. docs cite rule IDs that exist
if [ -n "$DOCS_DIR" ] && [ -d "$DOCS_DIR" ]; then
  valid=$(grep -oE '^- [IPCM][0-9]+\.' AGENTS.md | sed 's/[-. ]//g')
  grep -rhoiE '\brules? [IPCM][0-9]+\b' "$DOCS_DIR" | awk '{print toupper($2)}' | sort -u | while IFS= read -r id; do
    printf '%s\n' "$valid" | grep -qx "$id" || echo "FAIL: docs cite unknown rule $id"
  done | tee /tmp/gt-rules.$$ ; grep -q FAIL /tmp/gt-rules.$$ && fail=1; rm -f /tmp/gt-rules.$$
fi

# 8. grep gates over non-test source, comment lines dropped
[ -d "$SRC_DIR" ] || bad "SRC_DIR $SRC_DIR does not exist"
files=$(git ls-files "$SRC_DIR" 2>/dev/null | grep -E "$SOURCE_EXT" | grep -vE "$TEST_PATH_RE")
[ "$(printf '%s\n' "$files" | grep -c .)" -gt 0 ] || bad "grep gates scanned no source files under $SRC_DIR (M2)"
printf '%s\n' "$GREP_GATES" | grep -v '^$' | while IFS="$TAB" read -r name pattern exempt; do
  hits=''
  for f in $files; do
    rel=${f#"$SRC_DIR"/}
    [ -n "$exempt" ] && printf '%s\n' "$rel" | grep -qE "$exempt" && continue
    grep -vE '^[[:space:]]*(//|#|\*|/\*|--)' "$f" | grep -qE "$pattern" && hits="$hits $rel"
  done
  [ -z "$hits" ] || echo "FAIL: $name:$hits"
done | tee /tmp/gt-grep.$$ ; grep -q FAIL /tmp/gt-grep.$$ && fail=1; rm -f /tmp/gt-grep.$$

[ "$fail" -eq 0 ] && echo "instruction gate: ok ($count contracts, $words words)"
exit $fail
