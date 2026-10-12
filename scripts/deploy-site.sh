#!/usr/bin/env bash
# Push site/ to the web VM. Run by hand after a site change reaches main.
# Override the SSH host alias, target directory or checked URL:
#   SITE_HOST=other SITE_DIR=/srv/www/x SITE_URL=https://x.example/ scripts/deploy-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."
host="${SITE_HOST:-nitpub}"
dir="${SITE_DIR:-/var/www/calico}"
url="${SITE_URL:-https://calico.newto.sh/}"
# rsync --delete empties the target. Accept only an absolute path three levels down with no "..",
# so /var/www, which could hold other sites, is refused.
case "$dir" in
*..*) echo "refusing SITE_DIR=$dir: no .. allowed" >&2; exit 1 ;;
/?*/?*/?*) ;;
*) echo "refusing SITE_DIR=$dir: use an absolute path such as /var/www/calico" >&2; exit 1 ;;
esac
# An empty or missing site/ would empty the target.
[ -f site/index.html ] || { echo "site/index.html is missing: refusing to deploy" >&2; exit 1; }
rsync -a --no-owner --no-group --omit-dir-times --delete-after --chmod=D755,F644 --itemize-changes -- site/ "$host:$dir/"
curl -fsS -o /dev/null -w '%{http_code}\n' -I "$url"
