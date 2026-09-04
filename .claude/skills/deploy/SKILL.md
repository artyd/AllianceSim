---
name: deploy
description: Deploy AllianceSim to the server. The frontend is static files served by Caddy from /var/www/alliancesim; the backend is Docker (only rebuild it when api/ changed). Use to ship a merged change to production.
---

# Deploy

Run on the server (SSH). The user runs these — suggest them; do not run remote
commands yourself.

## Frontend-only change (the usual case)

Only `public/index.html` changed → no Docker rebuild, no restart. Fastest path
(works even if `git pull` is misconfigured, since the repo is public):

```bash
curl -fsSL https://raw.githubusercontent.com/artyd/AllianceSim/main/public/index.html \
  -o /var/www/alliancesim/index.html
```

Or via git (updates everything under public/):

```bash
cd /opt/alliancesim && git pull && sudo cp -r public/* /var/www/alliancesim/
```

Then hard-refresh the browser (**Ctrl+F5**) to bypass cache.

Sanity check the new file landed:

```bash
grep -c "content scale" /var/www/alliancesim/index.html   # any marker from the change
```

## Backend change (api/ touched)

```bash
cd /opt/alliancesim && git pull
sudo docker compose up -d --build
curl -s http://127.0.0.1:8011/health    # -> {"ok":true}
```

## Assets / first-time / Caddy / backups

See [`deploy/DEPLOY.md`](../../../deploy/DEPLOY.md) for the full runbook (env vars,
`EDIT_TOKEN`, Caddy site block, Postgres backups, troubleshooting).

> The HR access code is `EDIT_TOKEN` in the server's `.env`
> (`grep EDIT_TOKEN /opt/alliancesim/.env`). It is not knowable from the repo.
