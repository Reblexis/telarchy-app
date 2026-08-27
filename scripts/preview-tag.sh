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
# Bytes, not collation: in a UTF-8 locale sed's [a-z] can admit letters like
# "ß" that are not a DNS label, and tr's [:upper:] leaves "Ü" alone. In the C
# locale every non-ASCII byte becomes "-", which is what the TypeScript port
# (services/branches.ts) does too; branches.test.ts pins the two together.
export LC_ALL=C
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
