#!/usr/bin/env bash
# Derive the next version from the commits since the last release tag.
#
# The rules and the "no matching commits => no release" behaviour mirror the
# reference flow (mathieudutour/github-tag-action with PinyCore's rules), but the
# version arithmetic is done here: that action compares the latest tag against
# HEAD through the API, and a repository that has no tag yet (its very first
# push) yields an empty comparison, so it silently reports "no release" forever.
#
# Types that only bump a prerelease in the reference rules produce NO release
# here, because this repository rewrites its own version into package.json when
# it does release and has nowhere to put a nightly number.
#
#   .github/scripts/release.sh [<base-ref>]
#     base-ref defaults to GITHUB_EVENT_BEFORE, then to origin/HEAD
#     writes: released, version, previous, tag  (GITHUB_OUTPUT or stdout)
set -euo pipefail

TAG_PREFIX="v"
base="${1:-${GITHUB_EVENT_BEFORE:-}}"
if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ]; then
  base="$(git describe --tags --abbrev=0 2>/dev/null || true)"
fi
if [ -z "$base" ]; then
  base="$(git rev-list --max-parents=0 HEAD)"
fi

latest="$(git tag --list "${TAG_PREFIX}[0-9]*" --sort=-v:refname | head -n 1)"
if [ -n "$latest" ]; then
  previous="${latest#${TAG_PREFIX}}"
  range="${latest}..HEAD"
else
  previous="0.0.0"
  range="HEAD"
fi

major=0
minor=0
patch=0
while IFS= read -r subject; do
  [ -n "$subject" ] || continue
  type="${subject%%:*}"
  case "$type" in
    *'!'*) major=1 ;;
    feat) minor=1 ;;
    fix|perf|revert) patch=1 ;;
    docs) patch=1 ;;
  esac
done <<EOF
$(git log --format=%s "$range")
EOF

# A breaking change may also be declared in a footer rather than in the subject.
if git log --format=%B "$range" | grep -qE '^BREAKING[ -]CHANGE:'; then
  major=1
fi

if [ "$major" = 1 ]; then
  next="$(echo "$previous" | awk -F. '{printf "%d.0.0", $1 + 1}')"
elif [ "$minor" = 1 ]; then
  next="$(echo "$previous" | awk -F. '{printf "%d.%d.0", $1, $2 + 1}')"
elif [ "$patch" = 1 ]; then
  next="$(echo "$previous" | awk -F. '{printf "%d.%d.%d", $1, $2, $3 + 1}')"
else
  next=""
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "released=$([ -n "$next" ] && echo true || echo false)"
    echo "version=$next"
    echo "previous=$previous"
    echo "tag=${TAG_PREFIX}${next}"
  } >> "$GITHUB_OUTPUT"
else
  echo "released=$([ -n "$next" ] && echo true || echo false)"
  echo "version=$next"
  echo "previous=$previous"
  echo "tag=${TAG_PREFIX}${next}"
fi
