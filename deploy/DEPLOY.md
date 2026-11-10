# Deploying on Ubuntu (Proxmox VM/LXC) with a Cloudflare Tunnel

The app is static files, so the server only needs (1) something that serves the folder on localhost and (2) `cloudflared`, which makes an outbound connection to Cloudflare. Nothing is exposed on the Proxmox host or your router – no port-forwarding, no public IP, no TLS certificates to manage.

Works in an unprivileged LXC container just as well as a VM. Only outbound HTTPS (443) and 7844 (QUIC) are needed.

## 1. Copy the project to the server

From Windows (PowerShell), replace `user`/`server`:

```bash
scp -r C:\Users\ERIC\Desktop\RiichiMahjongScoreLearner user@server:~/riichi
```

(Or push the folder to a Git repo and `git clone` it on the server.)

## 2. Serve it with nginx on localhost

```bash
sudo apt update && sudo apt install -y nginx
sudo mkdir -p /var/www/riichi
sudo rsync -a --delete ~/riichi/ /var/www/riichi/ --exclude deploy --exclude README.md
sudo chown -R www-data:www-data /var/www/riichi
sudo cp ~/riichi/deploy/riichi.nginx.conf /etc/nginx/sites-available/riichi
sudo ln -sf /etc/nginx/sites-available/riichi /etc/nginx/sites-enabled/riichi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1:8080/ | head -n 5   # should print the start of index.html
```

The site listens on `127.0.0.1:8080` only, so it is reachable by cloudflared but not by anything else on the LAN.

## 3. Install cloudflared

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

## 4. Create the tunnel (dashboard-managed – recommended)

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → *Cloudflared*.
2. Name it (e.g. `riichi`). On the install page copy the command that looks like
   `sudo cloudflared service install eyJhIjoi...` and run it on the server. That installs a systemd service that starts on boot.
3. **Public Hostname** tab → **Add a public hostname**:
   - Subdomain: `riichi`, Domain: your zone (e.g. `example.com`)
   - Type: `HTTP`, URL: `localhost:8080`
4. Save. Cloudflare creates the DNS record automatically. Open `https://riichi.example.com`.

Check the service with:

```bash
sudo systemctl status cloudflared
```

### Alternative: CLI-managed tunnel

```bash
cloudflared tunnel login                       # opens a browser link to pick the zone
cloudflared tunnel create riichi               # prints the tunnel UUID
cloudflared tunnel route dns riichi riichi.example.com
```

Create `/etc/cloudflared/config.yml` (replace UUID and hostname):

```yaml
tunnel: <UUID>
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: riichi.example.com
    service: http://localhost:8080
  - service: http_status:404
```

Then `sudo cloudflared service install` and `sudo systemctl enable --now cloudflared`.

## 5. Updating the site later

```bash
scp -r C:\Users\ERIC\Desktop\RiichiMahjongScoreLearner\* user@server:~/riichi/
ssh user@server "sudo rsync -a --delete ~/riichi/ /var/www/riichi/ --exclude deploy --exclude README.md"
```

No restart needed – nginx serves the new files immediately (browsers may cache JS/CSS for up to an hour; hard-refresh with Ctrl+F5).

## Optional

- **Restrict access**: Zero Trust → **Access** → **Applications** → add `riichi.example.com` with a policy (e.g. emails you allow, or a one-time PIN). The tunnel already blocks everything except Cloudflare, so this is the only gate you need.
- **Docker instead of nginx + systemd**: see `docker-compose.yml` in this folder (point the Public Hostname at `http://web:80`).

## Play Trainer grading engine (akochan)

The Play Trainer grades your decisions with [akochan](https://github.com/critter-mj/akochan), a C++ mahjong AI. It runs on the server next to nginx; the page talks to it through `/api/` on the same hostname.

**License:** akochan is free for personal research and education only, and the author may change the terms. The install script downloads it from the author's repository; it is never copied into this project. Keep the site private (below).

### Install

From the cloned repo on the server:

```bash
cd ~/riichi && git pull && sudo bash deploy/install-akochan.sh
```

The script installs the build tools (g++, Boost), clones and builds akochan into `/opt/akochan`, installs the bridge service `akochan-bridge` (Python, listens on 127.0.0.1:8091, starts on boot), adds the `/api/` route to nginx, and runs a smoke test that prints akochan's first answers and how long they took.

If the build fails (akochan has not been updated in years, so a newer compiler may complain), copy the error messages so the build can be fixed.

Useful commands:

```bash
systemctl status akochan-bridge
journalctl -u akochan-bridge -n 50
python3 /opt/riichi-api/smoke_test.py --raw
```

`deploy/update.sh` also updates and restarts the bridge once it is installed. The service settings (threads, max concurrent games) are in `/etc/systemd/system/akochan-bridge.service`.

### Make the site private (Cloudflare Access)

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application name `Riichi`, domain = your site's hostname (e.g. `riichi.example.com`), leave the path empty so the whole site and `/api/` are covered.
3. Add a policy: Action **Allow**, Include **Emails** → your email address (add anyone else you want to let in).
4. Save. Visitors now get a login page that emails them a one-time code.
