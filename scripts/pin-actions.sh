#!/usr/bin/env bash
# Rewrite `uses: owner/repo@vN` to the latest release, pinned by commit SHA.
# Already-pinned lines (40-hex refs) are left alone. Needs `gh` logged in.
set -euo pipefail
for f in .github/workflows/*.yml; do
  { grep -oE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@v[0-9][A-Za-z0-9.]*$' "$f" || true; } | sort -u |
    while read -r _ ref; do
      repo=${ref%@*}
      base=$(echo "$repo" | cut -d/ -f1-2)
      tag=$(gh api "repos/$base/releases/latest" --jq .tag_name)
      sha=$(gh api "repos/$base/commits/$tag" --jq .sha)
      sed -i "s#uses: $ref\$#uses: $repo@$sha \# $tag#" "$f"
      echo "$f: $repo -> $tag ($sha)"
    done
done
