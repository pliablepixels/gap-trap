#!/bin/sh
# Count ratchet (AGENTS.md C7), language-neutral reference from gap-trap.
# Each counter is a shell command that prints one number. The baseline file
# records the last accepted count per name. A count may fall or hold; a rise
# fails, and a baseline more than SLACK above the real count fails too (a
# raised number nobody lowered back).
#
#   sh ratchet.sh            check
#   sh ratchet.sh --update   lower the baseline to the current counts
#
# --update only ever lowers. A count that rose, or a baseline name whose
# counter left the config, needs a hand edit, so the raise lands as a
# reviewable diff with a reason in the commit message rather than as a flag
# the agent can reach for. A counter command that fails is an error, never a
# zero: a broken command counted as 0 used to read as a clean sweep and
# invite --update to lock the zero in.
#
# Counters live in .ratchet-counters, one per line: name<TAB>command.
# ADAPT: seed it with the counts this repo needs, for example:
#   files_over_400	git ls-files 'src/*.go' | xargs wc -l | awk '$1>400 && $2!="total"' | wc -l
#   raw_prints	git ls-files 'src/*.go' | xargs grep -l 'fmt.Print' | wc -l
#   fixed_sleeps	git ls-files 'tests/*' | xargs grep -c 'time.Sleep\|sleep(' | awk -F: '{s+=$2} END{print s+0}'
#
# Exit codes: 0 within baseline, 1 a count grew or drifted, 2 the ratchet
# could not run (broken counter, missing counters or baseline file).
set -u
COUNTERS=${GT_RATCHET_COUNTERS:-.ratchet-counters}
BASELINE=${GT_RATCHET_BASELINE:-.ratchet-baseline}
SLACK=5
TAB=$(printf '\t')

[ -f "$COUNTERS" ] || { echo "ratchet: no $COUNTERS file"; exit 2; }

# name<SPACE>count per line, or name<SPACE>ERROR<SPACE>why when the command
# did not produce exactly one number.
read_counts() {
  grep -v '^#' "$COUNTERS" | grep -v "^[[:space:]]*$" | while IFS="$TAB" read -r name cmd; do
    [ -n "$name" ] || continue
    if [ -z "${cmd:-}" ]; then
      echo "$name ERROR no command after the tab"
      continue
    fi
    out=$(sh -c "$cmd" 2>&1)
    status=$?
    printed=$(printf '%s\n' "$out" | grep -c .)
    value=$(printf '%s' "$out" | tr -d '[:space:]')
    if [ "$status" -ne 0 ]; then
      echo "$name ERROR command exited $status"
    elif [ "$printed" -ne 1 ]; then
      echo "$name ERROR command printed $printed lines, expected one number"
    else
      case "$value" in
        ''|*[!0-9]*) echo "$name ERROR command printed a non-number: $value" ;;
        *) echo "$name $value" ;;
      esac
    fi
  done
}

current=$(read_counts)

broken=$(printf '%s\n' "$current" | grep ' ERROR ' || true)
if [ -n "$broken" ]; then
  printf '%s\n' "$broken" | while IFS= read -r line; do echo "ratchet: counter $line"; done
  echo "ratchet: a counter that cannot run is not a zero. Fix the command in $COUNTERS."
  exit 2
fi

count_of() { printf '%s\n' "$current" | awk -v n="$1" '$1==n{print $2; found=1} END{if(!found) print ""}'; }
allowed_of() { awk -v n="$1" '$1==n{print $2; found=1} END{if(!found) print ""}' "$BASELINE" 2>/dev/null; }

if [ "${1:-}" = "--update" ]; then
  refusals=''
  if [ -f "$BASELINE" ]; then
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      count=$(count_of "$name"); allowed=$(allowed_of "$name")
      if [ -z "$count" ]; then
        refusals="$refusals
$name: in the baseline but no counter is configured"
      elif [ -n "$allowed" ] && [ "$count" -gt "$allowed" ]; then
        refusals="$refusals
$name: $allowed -> $count is a rise"
      fi
    done <<EOF
$(awk '{print $1}' "$BASELINE")
EOF
  fi
  if [ -n "$refusals" ]; then
    printf '%s\n' "$refusals" | grep -v '^$'
    echo "--update only lowers. Edit $BASELINE by hand and say why in the commit message (C7)."
    exit 1
  fi
  printf '%s\n' "$current" > "$BASELINE"
  echo "Baseline written:"; cat "$BASELINE"; exit 0
fi
[ -f "$BASELINE" ] || { echo "ratchet: no $BASELINE; run --update once"; exit 2; }

# Every baseline name is checked too, so deleting a counter from $COUNTERS
# cannot retire the number it was holding.
names=$(printf '%s\n%s\n' "$(printf '%s\n' "$current" | awk '{print $1}')" "$(awk '{print $1}' "$BASELINE")" | grep -v '^$' | sort -u)
report=$(printf '%s\n' "$names" | while IFS= read -r name; do
  [ -n "$name" ] || continue
  count=$(count_of "$name")
  allowed=$(allowed_of "$name"); allowed=${allowed:-0}
  if [ -z "$count" ]; then
    echo "FAIL $name: in the baseline but no counter is configured; restore the counter, or delete the baseline entry and say why in the commit message"
  elif [ "$count" -gt "$allowed" ]; then
    echo "FAIL $name: $allowed allowed, $count found (+$((count - allowed)))"
  elif [ $((allowed - count)) -gt "$SLACK" ]; then
    echo "FAIL $name: baseline $allowed is $((allowed - count)) above the $count found; run --update"
  elif [ "$count" -lt "$allowed" ]; then
    echo "improved $name: $allowed -> $count, run --update to lock the gain in"
  fi
done)
[ -z "$report" ] || printf '%s\n' "$report"

case "$report" in
  *FAIL*) echo "Fix the new problems, or raise the number deliberately in $BASELINE and say why in the commit message."; exit 1 ;;
esac
echo "ratchet: counts within baseline"
exit 0
