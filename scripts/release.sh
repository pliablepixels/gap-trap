#!/usr/bin/env bash
# Cut a release: bump the version tag, write the notes from the commits
# since the last tag, and publish it with gh.
#
#   scripts/release.sh                  patch bump (v0.1.0 -> v0.1.1)
#   scripts/release.sh minor            v0.1.1 -> v0.2.0
#   scripts/release.sh v1.0.0           that exact version
#   scripts/release.sh minor --dry-run  print the version and notes, change nothing
#
# Refuses to run off main, with uncommitted changes, or when main and
# origin/main disagree, because the tag would name a tree nobody else has.
set -euo pipefail

cd "$(dirname "$0")/.."

bump=patch
explicit=""
dry=false
for arg in "$@"; do
  case "$arg" in
    major | minor | patch) bump=$arg ;;
    v[0-9]*) explicit=$arg ;;
    --dry-run) dry=true ;;
    *)
      echo "usage: $0 [major|minor|patch|vX.Y.Z] [--dry-run]" >&2
      exit 2
      ;;
  esac
done

branch=$(git branch --show-current)
[ "$branch" = main ] || { echo "on $branch, not main" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "uncommitted changes" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || {
  echo "main and origin/main differ; push or pull first" >&2
  exit 1
}

last=$(git tag -l 'v[0-9]*' --sort=-v:refname | head -1)

if [ -n "$explicit" ]; then
  next=$explicit
elif [ -z "$last" ]; then
  next=v0.1.0
else
  IFS=. read -r major minor patch <<<"${last#v}"
  case $bump in
    major) next="v$((major + 1)).0.0" ;;
    minor) next="v${major}.$((minor + 1)).0" ;;
    patch) next="v${major}.${minor}.$((patch + 1))" ;;
  esac
fi

git rev-parse -q --verify "refs/tags/$next" >/dev/null && { echo "$next exists" >&2; exit 1; }

range=${last:+$last..}HEAD
[ -n "$(git log --no-merges --format=%s "$range")" ] || { echo "nothing to release since $last" >&2; exit 1; }

known='^(feat|fix|docs|style|chore|ci|build|refactor|test|perf)(\([^)]+\))?!?:'

subjects() { git log --no-merges --format=%s "$range"; }

# One section per conventional-commit type, in the order a reader cares about.
# A subject with any other prefix, or none, lands in Other so nothing is dropped.
section() {
  local label=$1 lines=$2
  [ -n "$lines" ] || return 0
  printf '### %s\n' "$label"
  while IFS= read -r line; do
    printf -- '- %s\n' "${line#*: }"
  done <<<"$lines"
  printf '\n'
}

notes=$(
  section 'Added' "$(subjects | grep -E '^feat(\(|!?:)' || true)"
  section 'Fixed' "$(subjects | grep -E '^fix(\(|!?:)' || true)"
  section 'Documentation' "$(subjects | grep -E '^(docs|style)(\(|!?:)' || true)"
  section 'Internal' "$(subjects | grep -E '^(chore|ci|build|refactor|test|perf)(\(|!?:)' || true)"
  section 'Other' "$(subjects | grep -vE "$known" || true)"
)

if [ "$dry" = true ]; then
  printf '%s (from %s)\n\n%s\n' "$next" "${last:-the first commit}" "$notes"
  exit 0
fi

command -v gh >/dev/null || { echo "gh is not installed" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in" >&2; exit 1; }

git tag -a "$next" -m "$next" -m "$notes"
git push -q origin "$next"
gh release create "$next" --title "$next" --notes "$notes"
