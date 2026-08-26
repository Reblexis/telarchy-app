#!/bin/sh
# The Cloud Run URL tag for a branch preview (docs/infra/deploy.md, "Branch
# previews"): `br-` plus the branch name lowercased, anything outside
# [a-z0-9-] replaced by "-", runs of hyphens collapsed, no leading or trailing
# hyphen, at most 40 characters in all (a tag is a DNS label, and the tag URL
# prefixes "---api-..." to it). The one place the rule lives: the preview
# deploy, the cap and the retire job all call this.
#
#   sh scripts/preview-tag.sh 'oss/lane-i'   ->  br-oss-lane-i
set -eu
branch="${1:?usage: preview-tag.sh <branch-name>}"
name=$(printf '%s' "$branch" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -e 's/[^a-z0-9-]/-/g' -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//' \
  | cut -c1-37 \
  | sed -e 's/-$//')
if [ -z "$name" ]; then
  echo "preview-tag: branch '$branch' leaves nothing to name a tag with" >&2
  exit 1
fi
printf 'br-%s\n' "$name"
