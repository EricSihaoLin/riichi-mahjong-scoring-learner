#!/usr/bin/env bash
# Builds the akochan mahjong AI and runs it behind the Play Trainer's /api so your decisions get graded.
# akochan (github.com/critter-mj/akochan) is free for personal research and education only. It is downloaded
# from its author's repository here and never copied into this project. Keep the site private (Cloudflare Access).
#
# Usage (from the cloned repo):   sudo bash deploy/install-akochan.sh
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo bash deploy/install-akochan.sh"; exit 1; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AKO=/opt/akochan
API=/opt/riichi-api

echo "==> Installing build tools"
apt-get update -q
apt-get install -y -q build-essential git libboost-system-dev python3 curl

echo "==> Getting akochan"
if [[ -d $AKO/.git ]]; then git -C "$AKO" pull --ff-only || true
else git clone --depth 1 https://github.com/critter-mj/akochan.git "$AKO"; fi

echo "==> Building akochan (this can take 10+ minutes)"
# akochan predates GCC 13, which no longer pulls in these headers implicitly (e.g. uint8_t in json11.cpp).
# It also links -lboost_system, which has been header-only since Boost 1.69 and whose empty stub library
# newer Boost releases no longer ship – an empty archive satisfies the linker.
mkdir -p "$AKO/.stub"
printf '!<arch>\n' > "$AKO/.stub/libboost_system.a"
COMPILER="g++ -L$AKO/.stub -include cstdint -include cstddef -include limits -include algorithm -include stdexcept"
build() { make -f Makefile_Linux -j"$(nproc)" "COMPILER=$COMPILER" || make -f Makefile_Linux "COMPILER=$COMPILER"; }
cd "$AKO/ai_src"
build
cd "$AKO"
# Its mjai TCP client (unused here, but linked into system.exe) uses Boost.Asio calls removed in Boost 1.87.
# Switch to the replacements that exist since Boost 1.66 (local build copy only).
sed -i 's/boost::asio::io_service /boost::asio::io_context /' mjai_client.hpp
sed -i -e 's/boost::asio::ip::address::from_string(/boost::asio::ip::make_address(/' \
       -e 's/boost::asio::buffer_cast<const char \*>(buffer\.data())/static_cast<const char *>(buffer.data().data())/' mjai_client.cpp
build
if [[ ! -f $AKO/libai.so || ! -x $AKO/system.exe ]]; then
  echo "!! The build did not produce libai.so and system.exe. Send the error messages above to get it fixed."
  exit 1
fi
cp "$REPO_DIR/deploy/akochan-tactics.json" "$AKO/tactics.json"

echo "==> Installing the bridge service (127.0.0.1:8091)"
id akochan >/dev/null 2>&1 || useradd --system --home-dir "$AKO" --shell /usr/sbin/nologin akochan
chown -R akochan:akochan "$AKO"
mkdir -p "$API"
cp "$REPO_DIR/server/akochan_server.py" "$REPO_DIR/server/smoke_test.py" "$API/"
cp "$REPO_DIR/deploy/akochan-bridge.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable akochan-bridge
systemctl restart akochan-bridge

echo "==> Routing /api through nginx"
cp "$REPO_DIR/deploy/riichi.nginx.conf" /etc/nginx/sites-available/riichi
nginx -t
systemctl reload nginx

echo "==> Smoke test (akochan's first answers can take a while)"
sleep 2
if ! python3 "$API/smoke_test.py"; then
  echo "!! Smoke test failed. Service log:"
  journalctl -u akochan-bridge -n 40 --no-pager
  exit 1
fi
echo
echo "Through nginx: $(curl -fsS http://127.0.0.1:8080/api/akochan/health)"
echo
echo "Done. Open the Play Trainer – the review panel should say 'graded by akochan'."
echo "Remember to protect the site with Cloudflare Access (see deploy/DEPLOY.md)."
