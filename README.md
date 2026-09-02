# AllianceSim

Office layout & employee-seating tool for HR. HR builds the office layout (rooms,
zones, furniture) and seats employees; employees open a public link to find their
own desk ("find my seat"). Built as an MVP: single-page frontend + a small
Express/Postgres backend, deployed behind Caddy with automatic HTTPS.

- **Live:** https://alliancesim.alliancegroup95.com
- **Backend port:** `8011` (loopback-only; Caddy fronts TLS + routing)

## Architecture

```
Browser ──HTTPS──> Caddy
                     ├─ /         → static frontend  (/var/www/alliancesim)
                     └─ /api/*    → 127.0.0.1:8011 (Docker: api) → Postgres (Docker)
```

## Repository layout

```
api/                Express + pg backend (Dockerized)
  src/index.js      routes (layout + employees + health)
  src/db.js         pg pool + idempotent schema init
  src/auth.js       X-Edit-Token write guard
caddy/Caddyfile     Caddy site block (imported into /etc/caddy/Caddyfile)
public/             static frontend (index.html + assets) served by Caddy
docker-compose.yml  db (postgres:16) + api services
.env.example        POSTGRES_*, EDIT_TOKEN, PORT
deploy/DEPLOY.md    step-by-step server deployment
```

## API

Public reads, token-guarded writes (`X-Edit-Token: <EDIT_TOKEN>`).
All paths work both directly (`:8011/api/...`) and via Caddy (which strips `/api`).

| Method | Path | Access |
|---|---|---|
| GET | `/api/health` | public |
| GET | `/api/layout` | public |
| PUT | `/api/layout` | token |
| GET | `/api/employees` | public |
| POST | `/api/employees` | token |
| PUT | `/api/employees/:id` | token |
| DELETE | `/api/employees/:id` | token |
| GET | `/api/employees/search?q=` | public |

## Auth (MVP)

One shared write token for the HR team (`EDIT_TOKEN` env var). Reads are public.
Per-person HR login / audit trail is a v2 item.

## Deploy

See [`deploy/DEPLOY.md`](deploy/DEPLOY.md). TL;DR on the server:

```bash
sudo mkdir -p /opt/alliancesim && sudo chown "$USER" /opt/alliancesim   # /opt is root-owned
git clone https://github.com/artyd/AllianceSim.git /opt/alliancesim
cd /opt/alliancesim && cp .env.example .env   # set POSTGRES_PASSWORD + EDIT_TOKEN
sudo docker compose up -d --build
sudo mkdir -p /var/www/alliancesim && sudo cp -r public/* /var/www/alliancesim/
# add `import /opt/alliancesim/caddy/Caddyfile` to /etc/caddy/Caddyfile, reload caddy
```

## Data & offline

Layout and employees are stored centrally in Postgres. The frontend keeps
`localStorage` as an offline fallback: if `/api/*` is unreachable, changes are
held locally and synced back once the backend responds again.
