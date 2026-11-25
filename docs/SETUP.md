# Setting up Intervolt ECMS (free)

You need one computer that stays on, which runs everything in Docker: the app, the database, hourly reminders and nightly backups.
Pick **Option A (recommended)** or **Option B**. Steps 3 to 7 are the same for both.

| | Option A: Oracle Cloud Always Free | Option B: Office PC |
|---|---|---|
| Cost | Free (credit card needed for identity check only) | Free (your PC + electricity) |
| Uptime | Always on, data-centre power and internet | Off when the PC is off, restarting, or the internet drops |
| Access from phones on site | Yes | Yes, with port forwarding or a tunnel |
| Effort | About 45 minutes once | About 30 minutes once |

Phones only allow GPS clock-in on **HTTPS** addresses. Step 6 gives you a free HTTPS address.

---

## Option A — Oracle Cloud Always Free

1. Sign up at **cloud.oracle.com** → *Start for free*. Choose the home region closest to you (e.g. *Canada Southeast (Toronto)*). You will not be charged unless you upgrade the account.
2. Create the server: **Menu → Compute → Instances → Create instance**.
   - Image: **Ubuntu 24.04** (or 22.04).
   - Shape: **Ampere → VM.Standard.A1.Flex**, **2 OCPU, 12 GB memory** (stays inside the free allowance).
   - Networking: keep the defaults; make sure **Assign a public IPv4 address** is on.
   - SSH keys: **Generate a key pair for me** and **download both keys**. Keep them safe.
   - Click **Create**. If you see "Out of capacity", try another *Availability domain* or try again later.
3. Open web ports: on the instance page click the **Subnet** link → **Security list** → **Add ingress rules**:
   source `0.0.0.0/0`, TCP, destination ports **80,443**.
4. Connect: on Windows open *PowerShell*, on Mac open *Terminal*:
   ```bash
   ssh -i path/to/downloaded-private-key ubuntu@YOUR_PUBLIC_IP
   ```
5. On the server, allow the web ports through Ubuntu's firewall:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

Continue with **Step 1** below.

## Option B — Office PC

1. Use a PC that can stay on 24/7 (Windows 10/11 Pro or Home, or Linux). Turn off sleep: *Settings → System → Power → Sleep: Never*.
2. Install **Docker Desktop** (free for small businesses under 250 staff / $10M revenue) from docker.com and **Git for Windows** from git-scm.com. Restart.
3. Give the PC a fixed local IP in your router (DHCP reservation) and **forward ports 80 and 443** from the router to that PC. (Your router's admin page, usually 192.168.0.1 or 192.168.1.1.)
4. Open *PowerShell* and continue with **Step 1** below (commands are the same; skip the `sudo` lines in Step 1).

---

## Step 1 — Install Docker (Linux / Oracle only)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```
Reconnect with `ssh` so the change takes effect.

## Step 2 — Download the app from your private GitHub repo

GitHub needs a token to download a private repo:
GitHub → your picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** →
Repository access: *Only select repositories* → `intervolt-ecms` → Permissions: **Contents: Read-only** → Generate. Copy the token.

```bash
git clone https://github.com/vsin231298/intervolt-ecms.git
# Username: vsin231298   Password: paste the token
cd intervolt-ecms
```

## Step 3 — Configure

```bash
cp .env.production.example .env
nano .env        # (Windows: notepad .env)
```
Change every `CHANGE_ME` value. Use long random passwords; you can make one with `openssl rand -hex 24`.
Set `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` for your own first login.

## Step 4 — Start

```bash
docker compose up -d --build                 # first build takes 5–10 minutes
docker compose run --rm app npm run db:setup # creates your admin login (once)
docker compose ps                            # app should show "healthy"
```
Test on the server/office network: `http://YOUR_IP:3000`.

## Step 5 — Get a free web address (DuckDNS)

1. Go to **duckdns.org**, sign in (Google/GitHub), and create a sub-domain such as `intervolt-ecms` → you get `intervolt-ecms.duckdns.org`.
2. Put your public IP in the *current ip* box and click *update ip*. (Oracle's IP never changes. For an office connection whose IP changes, follow DuckDNS's *install* page to set up the free auto-updater.)

## Step 6 — Turn on HTTPS

In `.env` set:
```
DOMAIN=intervolt-ecms.duckdns.org
APP_URL=https://intervolt-ecms.duckdns.org
```
Then:
```bash
docker compose --profile https up -d
```
Caddy obtains and renews a free certificate automatically. Open **https://intervolt-ecms.duckdns.org** and sign in.

*Already own a domain on Cloudflare?* Instead of Steps 5–6 you can use a free Cloudflare Tunnel (no router ports needed):
Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create → copy the token into `CLOUDFLARE_TUNNEL_TOKEN`, route your hostname to `http://app:3000`, then `docker compose --profile tunnel up -d`.

## Step 7 — First things to do in the app

1. **Admin → Settings**: company name, address, HST number; check tax %, holdback %, payment terms, labour rate, overtime rule (see [ASSUMPTIONS.md](ASSUMPTIONS.md)).
2. **Admin → Users & Roles**: add each person with their role.
3. **Employees**: add workers with rates; for electricians, link their user login so they can clock in.
4. **Clients & Suppliers**: add clients, consultants and suppliers.
5. **Documents → Company library**: upload WSIB, insurance, COR/safety documents and templates (set expiry dates to get reminders).

---

## Backups

- A backup runs automatically every night (database + uploaded files) into the `backups/` folder, keeping 14 days.
- Run one now: `docker compose exec backup sh /backup.sh /backups /storage`
- **Off-site copy (free):** install `rclone` (`sudo apt install rclone`), run `rclone config` and add your Google Drive or OneDrive, then add a daily copy:
  ```bash
  crontab -e
  # add this line:
  30 3 * * * rclone copy ~/intervolt-ecms/backups gdrive:intervolt-backups --max-age 48h
  ```
- Restore: `sh scripts/restore.sh backups/db_YYYY-MM-DD_HHMM.dump backups/files_YYYY-MM-DD_HHMM.tar.gz` (asks for confirmation; replaces current data).

## Updating to a new version

```bash
cd intervolt-ecms
git pull
docker compose up -d --build
```
Database changes are applied automatically on start. Make a backup first.

## Useful commands

| Task | Command |
|---|---|
| See status | `docker compose ps` |
| App logs | `docker compose logs -f app` |
| Restart | `docker compose restart app` |
| Stop everything | `docker compose down` (data is kept) |
| Health check | `curl http://localhost:3000/api/health` |

## Troubleshooting

- **Can't sign in after enabling HTTPS:** make sure `APP_URL` starts with `https://` and you open the `https://` address.
- **Clock-in says location unavailable:** the site must be opened over HTTPS, and the phone must allow location for the browser. Clock-in still works without location.
- **Certificate not issued:** ports 80 and 443 must reach the machine (Oracle security list + iptables, or router port forwarding), and DuckDNS must point at your current IP.
