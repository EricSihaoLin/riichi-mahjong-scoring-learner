#!/usr/bin/env bash
# Pull the latest version and republish it. Usage: sudo bash deploy/update.sh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
git -C "$REPO_DIR" pull --ff-only
rsync -a --delete --exclude .git --exclude deploy --exclude server --exclude README.md --exclude .gitattributes "$REPO_DIR/" /var/www/riichi/
chown -R www-data:www-data /var/www/riichi
if [[ -d /opt/riichi-api ]]; then
  cp "$REPO_DIR/server/akochan_server.py" "$REPO_DIR/server/smoke_test.py" /opt/riichi-api/
  cp "$REPO_DIR/deploy/akochan-bridge.service" /etc/systemd/system/
  cp "$REPO_DIR/deploy/riichi.nginx.conf" /etc/nginx/sites-available/riichi
  systemctl daemon-reload
  systemctl restart akochan-bridge
  nginx -t && systemctl reload nginx
fi
echo "Updated. Hard-refresh the browser (Ctrl+F5) if you still see the old version."
