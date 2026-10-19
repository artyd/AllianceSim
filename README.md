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
public/      static site, no build step: index.html + css/ + js/{office,phone,games,analytics}/
api/src/     Express + Postgres: lib/ + office/ phone/ games/ analytics/ routers
bot/src/     Telegram bot (grammy): lib/ + features/
tests/       real-stack tests: api/, ui/ (headless Chrome), pw/ (Playwright)
docs/        SDD.md, specs/, adr/, agents/      GLOSSARY.md — the project's vocabulary
deploy/      DEPLOY.md runbook + backup.sh      caddy/ — Caddy site block
```

The annotated map for contributors (and coding agents) is in [`CLAUDE.md`](CLAUDE.md).

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

One shared **HR access code** for the whole HR team (`EDIT_TOKEN` env var). Set a
short, memorable value (e.g. `alliance2025`) in `.env`. In the app, HR clicks
**Зберегти планування** once, types this code in the prompt, and it is remembered
in that browser for future saves. Reads are public: everyone else opens the
read-only share link (**Поділитися посиланням** → `?mode=viewer`), which hard-locks
the app to view-only. Per-person HR login / audit trail is a v2 item.

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
