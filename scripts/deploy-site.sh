#!/usr/bin/env bash
# Push site/ to the web VM. Run by hand after a site change reaches main.
# Override the SSH host alias or target dir: SITE_HOST=other SITE_DIR=/srv/x scripts/deploy-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."
host="${SITE_HOST:-nitpub}"
dir="${SITE_DIR:-/var/www/calico}"
rsync -a --no-owner --no-group --delete --chmod=D755,F644 --itemize-changes site/ "$host:$dir/"
curl -fsSI "https://calico.newto.sh/" | head -n 1
