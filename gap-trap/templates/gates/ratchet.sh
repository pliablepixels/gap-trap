#!/bin/sh
# Count ratchet (AGENTS.md C7), language-neutral reference from gap-trap.
# Each counter is a shell command that prints one number. The baseline file
# records the last accepted count per name. A count may fall or hold; a rise
# fails, and a baseline more than SLACK above the real count fails too (a
# raised number nobody lowered back).
#
#   sh ratchet.sh            check
#   sh ratchet.sh --update   rewrite the baseline from the current tree
#
# Counters live in .ratchet-counters, one per line: name<TAB>command.
# ADAPT: seed it with the counts this repo needs, for example:
#   files_over_400	git ls-files 'src/*.go' | xargs wc -l | awk '$1>400 && $2!="total"' | wc -l
#   raw_prints	git ls-files 'src/*.go' | xargs grep -l 'fmt.Print' | wc -l
#   fixed_sleeps	git ls-files 'tests/*' | xargs grep -c 'time.Sleep\|sleep(' | awk -F: '{s+=$2} END{print s+0}'
set -u
COUNTERS=${GT_RATCHET_COUNTERS:-.ratchet-counters}
BASELINE=${GT_RATCHET_BASELINE:-.ratchet-baseline}
SLACK=5

[ -f "$COUNTERS" ] || { echo "ratchet: no $COUNTERS file"; exit 2; }
current=$(grep -v '^#' "$COUNTERS" | grep -v '^$' | while IFS='	' read -r name cmd; do
  n=$(sh -c "$cmd" 2>/dev/null | tr -d ' ')
  echo "$name ${n:-0}"
done)

if [ "${1:-}" = "--update" ]; then
  printf '%s\n' "$current" > "$BASELINE"
  echo "Baseline written:"; cat "$BASELINE"; exit 0
fi
[ -f "$BASELINE" ] || { echo "ratchet: no $BASELINE; run --update once"; exit 2; }

fail=0
printf '%s\n' "$current" | while read -r name count; do
  allowed=$(awk -v n="$name" '$1==n{print $2}' "$BASELINE")
  allowed=${allowed:-0}
  if [ "$count" -gt "$allowed" ]; then
    echo "FAIL $name: $allowed allowed, $count found (+$((count - allowed)))"
  elif [ $((allowed - count)) -gt "$SLACK" ]; then
    echo "FAIL $name: baseline $allowed is $((allowed - count)) above the $count found; run --update"
  elif [ "$count" -lt "$allowed" ]; then
    echo "improved $name: $allowed -> $count, run --update to lock the gain in"
  fi
done | tee /tmp/ratchet.$$
grep -q '^FAIL' /tmp/ratchet.$$ && fail=1
rm -f /tmp/ratchet.$$
[ "$fail" -eq 0 ] && echo "ratchet: counts within baseline" || echo "Fix the new problems, or raise the number deliberately and say why in the commit message."
exit $fail
