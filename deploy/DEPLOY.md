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
