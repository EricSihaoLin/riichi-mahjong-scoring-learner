#!/usr/bin/env bash
# One-shot server setup for Ubuntu: nginx on 127.0.0.1:8080 + cloudflared installed.
# Usage (from the cloned repo):   sudo bash deploy/setup.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo bash deploy/setup.sh"; exit 1; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR=/var/www/riichi

echo "==> Installing nginx and rsync"
apt-get update -q
apt-get install -y -q nginx rsync curl

echo "==> Copying site to $SITE_DIR"
mkdir -p "$SITE_DIR"
rsync -a --delete --exclude .git --exclude deploy --exclude README.md --exclude .gitattributes "$REPO_DIR/" "$SITE_DIR/"
chown -R www-data:www-data "$SITE_DIR"

echo "==> Configuring nginx site (listens on 127.0.0.1:8080 only)"
cp "$REPO_DIR/deploy/riichi.nginx.conf" /etc/nginx/sites-available/riichi
ln -sf /etc/nginx/sites-available/riichi /etc/nginx/sites-enabled/riichi
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Installing cloudflared"
if ! command -v cloudflared >/dev/null; then
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -y -q cloudflared
fi

echo
echo "==> Local check:"
curl -fsS http://127.0.0.1:8080/ | head -n 3 || echo "!! nginx did not answer on 127.0.0.1:8080"
echo
echo "Done. Next step: create the tunnel in Cloudflare Zero Trust and run the"
echo "'sudo cloudflared service install <TOKEN>' command it gives you, then add a"
echo "Public Hostname pointing to  http://localhost:8080"
