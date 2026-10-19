# AllianceSim — project guide for Claude

Office tool for HR at Альянс Груп 95: a live floor plan of the office (rooms, furniture,
zones, colleagues) plus a personal phone for every employee inside the Telegram Mini App.
Words used here — office plan, linked employee, check-in, pulse, … — are defined in
**`GLOSSARY.md`**; decisions that look surprising are explained in **`docs/adr/`**.

## Map

```
public/                 static site, no build step (ADR-0001)
  index.html            markup only — links css/ and js/office/app.js
  css/                  office · phone · games · phone-shell (load order = cascade order)
  js/office/            app.js (state, 2D/3D renderers, roaming, UI) · catalog.js (pure data) · hr.js (analytics tab + HR settings)
  js/phone/phone.js     AllianceOS phone; office deps arrive via initPhone({get state(){…}, …})
  js/games/             engines.js (pure rules + bots, unit-tested in Node) · ui.js
  js/analytics/         HR analytics view shared by the site and the phone
  sw.js                 PWA cache — list every new public/ file in SHELL
api/src/                Express + Postgres; index.js mounts every router at / and /api
  lib/                  db (schema), auth (HR code), session (/me identity), telegram, kv, notify, realtime, recur, names
  office/ phone/ games/ analytics/   one folder per area, routers + their jobs
bot/src/                grammy bot; lib/ (Bot instance, api client, enums) · features/ (one file per feature; import order = handler order)
tests/                  api/ (HTTP + bot e2e) · ui/ (headless Chrome) · pw/ (Playwright layout audit)
docs/                   SDD.md (the loop) · specs/ (one spec per feature) · adr/ · agents/ (skill config)
deploy/ caddy/          production runbook, Caddy site block
```

## Workflow (SDD loop — `docs/SDD.md`)

1. Non-trivial change → a spec first: `/spec` (or `/to-spec` after a discussion) in `docs/specs/`; design in plan mode. `/grill-with-docs` when the request is fuzzy.
2. Small edits. The PostToolUse hook (`.claude/scripts/check-html.mjs`) checks every saved frontend file — syntax and that relative imports / linked files exist. Fix what it reports before moving on.
3. Verify for real: `cd tests && npm test` (api + bot + browser) and `npm run test:pw` for layout; `/serve` + the `app-verify` agent for a manual look. Done means green tests and **no console errors**. Every feature adds a test scenario (ADR-0007).
4. One change per commit; set the spec's `Status:` and commit hash.

## Invariants (office plan — `frontend-review` agent checks them)

- One `state = {furniture, zones, rects, employees, depts}`; mutate via `pushUndo()` + `markDirty()`; roaming `EP` never goes into `state` (ADR-0002).
- Two renderers over one state: Canvas-2D `draw2D` (default) and Three.js 3D — handle new geometry in both; `sync*` no-op in 2D; set `dirty2d = true` when the 2D picture changes (ADR-0003).
- View transform is rotation/flip aware (`w2s`/`s2w`/`project`); content scale `CS` scales furniture and people together; a seat is optional.
- Never depend on `requestAnimationFrame` running (paused in hidden tabs).
- Personal data is `/me/*` tables, scoped to the caller; the weekly pulse is aggregate-only (ADR-0006).

## Deploy

`/deploy` skill. Frontend only → copy `public/*`. `api/` or `bot/` touched → `docker compose up -d --build`. The HR code is `EDIT_TOKEN` in the server `.env`, not in the repo.

## Agent skills

`.claude/skills/README.md` lists them (project skills + mattpocock/skills; `/ask-matt` picks one).

### Issue tracker

Specs and tickets are local markdown in `docs/specs/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) as `Status:` lines. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
