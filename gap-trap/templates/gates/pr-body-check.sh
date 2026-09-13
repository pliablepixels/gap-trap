#!/bin/sh
# PR body check (AGENTS.md P1), reference from gap-trap. Reads PR_TITLE and
# PR_BODY from the environment (CI passes them through `env:`, never by
# interpolating into the run script: a title is attacker-controlled text).
#
#   PR_TITLE='feat: x' PR_BODY="$(cat body.md)" sh pr-body-check.sh
#
# Fails when `## Acceptance` has no content after HTML comments are removed,
# and, on a feat title, when `## Spec` has none.
set -u
: "${PR_BODY:?PR_BODY is required}"
: "${PR_TITLE:=}"

section() {
  printf '%s' "$PR_BODY" | awk -v h="$1" '$0 ~ "^##[[:space:]]*"h {f=1;next} /^##[[:space:]]/{f=0} f' | perl -0pe 's/<!--.*?-->//gs' | tr -d '[:space:]'
}

if [ -z "$(section Acceptance)" ]; then
  echo "::error title=No acceptance lines::This PR body has no '## Acceptance' section with content (AGENTS.md P1: the Spec review axis judges the diff against the issue's acceptance lines)."
  exit 1
fi
case "$PR_TITLE" in
  feat*)
    if [ -z "$(section Spec)" ]; then
      echo "::error title=No spec::A feat PR needs a '## Spec' section: a link to its spec, or one line saying why this feature needs none."
      exit 1
    fi
    ;;
esac
echo "PR body sections present."
