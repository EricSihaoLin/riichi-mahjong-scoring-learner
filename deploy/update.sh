#!/usr/bin/env bash
# Pull the latest version and republish it. Usage: sudo bash deploy/update.sh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
git -C "$REPO_DIR" pull --ff-only
rsync -a --delete --exclude .git --exclude deploy --exclude README.md --exclude .gitattributes "$REPO_DIR/" /var/www/riichi/
chown -R www-data:www-data /var/www/riichi
echo "Updated. Hard-refresh the browser (Ctrl+F5) if you still see the old version."
