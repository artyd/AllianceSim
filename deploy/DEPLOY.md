# AllianceSim — Deployment (server)

Modeled on the existing TypTap setup: Node + Postgres in Docker, Caddy as reverse
proxy with automatic HTTPS. AllianceSim uses port **8011** (TypTap uses 8010).

Run these on the shared Linux server (the one already hosting TypTap).

---

## 0. Prerequisites (one-time)

```bash
# DNS: alliancesim → server IP
dig +short alliancesim.alliancegroup95.com          # must return the server's IP

# Ports 80 and 443 open (Caddy grabs the certificate itself)

# Docker + Compose present (shared with TypTap)
sudo docker compose version

# Caddy installed and running (shared instance)
systemctl status caddy --no-pager | head -3
```

---

## 1. Get the code

```bash
sudo mkdir -p /opt/alliancesim && sudo chown "$USER" /opt/alliancesim
git clone https://github.com/artyd/AllianceSim.git /opt/alliancesim
cd /opt/alliancesim
```

(To update later: `cd /opt/alliancesim && git pull`.)

---

## 2. Configure environment

```bash
cd /opt/alliancesim
cp .env.example .env
# Set POSTGRES_PASSWORD and EDIT_TOKEN to strong random values:
openssl rand -hex 24     # → paste as POSTGRES_PASSWORD
openssl rand -hex 24     # → paste as EDIT_TOKEN  (give this to the HR team)
nano .env
```

`.env` must have real values for `POSTGRES_PASSWORD` and `EDIT_TOKEN`. Keep `PORT=8011`.

---

## 3. Bring up the backend (Docker, port 8011 loopback)

```bash
cd /opt/alliancesim
sudo docker compose up -d --build

# Verify
curl -s http://127.0.0.1:8011/health            # -> {"ok":true}
sudo docker compose logs api --tail=30
```

### Smoke test the API

```bash
TOKEN=$(grep EDIT_TOKEN .env | cut -d= -f2)

curl -s http://127.0.0.1:8011/api/layout
# -> {"data":null}   (or the saved layout)

curl -s -X PUT http://127.0.0.1:8011/api/layout \
  -H 'content-type: application/json' -H "X-Edit-Token: $TOKEN" \
  -d '{"data":{"rooms":[],"furniture":[],"zones":[]}}'
# -> {"ok":true}

curl -s -X PUT http://127.0.0.1:8011/api/layout \
  -H 'content-type: application/json' -H 'X-Edit-Token: wrong' \
  -d '{"data":{}}'
# -> {"error":"invalid or missing edit token"}   (HTTP 401)

curl -s -X POST http://127.0.0.1:8011/api/employees \
  -H 'content-type: application/json' -H "X-Edit-Token: $TOKEN" \
  -d '{"name":"Ivan Petrenko","department":"Sales"}'
# -> {"id":"...","name":"Ivan Petrenko","department":"Sales","desk_id":null,...}

curl -s "http://127.0.0.1:8011/api/employees/search?q=ivan"
# -> [{"id":"...","name":"Ivan Petrenko",...}]
```

---

## 4. Static frontend files (served by Caddy)

```bash
sudo mkdir -p /var/www/alliancesim
sudo cp -r /opt/alliancesim/public/* /var/www/alliancesim/
```

(Re-run this copy after every `git pull` that changes the frontend.)

> **3D avatar models:** the employee figures load from `public/assets/models/{sit,stand,walk}.glb`.
> These are large custom meshes not stored in git (see `public/assets/models/README.md`) — copy them
> into that folder from the original design project, then re-run the copy above. Without them the app
> still fully works; seated employees just show as a marker + name tag instead of a 3D figure.

---

## 5. Caddy site block

```bash
grep -q 'import /opt/alliancesim/caddy/Caddyfile' /etc/caddy/Caddyfile || \
  echo 'import /opt/alliancesim/caddy/Caddyfile' | sudo tee -a /etc/caddy/Caddyfile

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 6. Final verification

```bash
curl -s https://alliancesim.alliancegroup95.com/api/health    # -> {"ok":true}
```

Open **https://alliancesim.alliancegroup95.com**:
- **Viewer mode** (default, public): search your name → see your desk.
- **Builder mode** (HR): prompts for the access code (`EDIT_TOKEN`) on first save;
  the code is stored in the browser and sent as `X-Edit-Token` on every write.

---

## Backups

```bash
cd /opt/alliancesim
sudo docker compose exec -T db pg_dump -U "$(grep POSTGRES_USER .env|cut -d= -f2)" \
  "$(grep POSTGRES_DB .env|cut -d= -f2)" > alliancesim-backup-$(date +%F).sql
```

Restore:

```bash
cat alliancesim-backup-YYYY-MM-DD.sql | sudo docker compose exec -T db \
  psql -U "$(grep POSTGRES_USER .env|cut -d= -f2)" "$(grep POSTGRES_DB .env|cut -d= -f2)"
```

Postgres data lives in the `pgdata` docker volume (survives rebuilds).
`docker compose down -v` **deletes the layout and all employees** — warn HR first.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `/api/health` doesn't respond | `sudo docker compose ps`, `sudo docker compose logs api` |
| api won't start, "database not reachable" | `sudo docker compose logs db`; does `.env` password match? |
| Port 8011 already in use | `sudo ss -ltnp \| grep 8011` — change `PORT` in `.env` and `caddy/Caddyfile`, rebuild, reload Caddy |
| Saving layout fails (401) | DevTools → Network: `X-Edit-Token` present and correct? |
| Employee search finds nothing | `curl http://127.0.0.1:8011/api/employees` — is there data? |
| Caddy won't get a certificate | DNS not pointing to server yet, or ports 80/443 closed |
