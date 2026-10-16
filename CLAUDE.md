# AllianceSim — project guide for Claude

Office floor-plan tool for HR: build the layout (rooms, furniture, zones), seat or
free-roam colleagues, share a read-only link.

## Shape
- **Frontend: `public/index.html` + `public/phone.js`** — the office app is the HTML shell
  + `<style>` + one `<script type="module">`; the phone (AllianceOS, personal Mini App) is
  the ES module `phone.js`, wired in via `initPhone({get state(){…}, …})` — add any new
  office dependency to that call (`state` stays a getter: the office reassigns it).
  Mini-games: `public/games-engines.js` (pure rules/bots, unit-tested in Node) +
  `public/games.js` (UI, wired via `initGamesUI`). PWA: `manifest.json` + `sw.js` (network-first).
  No build step, no framework.
- **Backend: `api/`** (Express + Postgres). The office plan is one `state` blob saved to
  `PUT /layout` (token-gated); employees and all personal phone data (chats, calendar,
  tasks, desks, snapshots) are DB tables behind `/me/*` (caller-scoped) — specs 004/005.
- **Bot: `bot/`** (grammy) — check-in, notifications with buttons, replies → chats.
- Deployed with Docker + Caddy — see `deploy/DEPLOY.md`.

## How to work here (SDD loop — see `docs/SDD.md`)
1. For non-trivial changes, write a short spec first (`/spec`, `specs/_template.md`)
   and design in **plan mode**.
2. Edit `public/index.html` / `public/phone.js` in small steps. A **PostToolUse hook**
   syntax-checks both automatically after each save
   (`.claude/scripts/check-html.mjs`) — fix any reported error before moving on.
3. **Verify in the browser** — don't trust parsing alone. Use `/serve`
   (`node .claude/scripts/serve.cjs public 5055`) and the **`app-verify`** agent;
   confirm **no console errors**.
   For api/bot/phone changes run the suite in `tests/` (`cd tests && npm test`, plus
   `npm run test:pw` — Playwright layout/a11y audit on phone + web sizes): real api
   on embedded Postgres, the bot against a fake Bot API, Mini App in headless Chrome as
   faked Telegram users. Add a scenario for every new feature.
4. Commit one change at a time; update the spec status.

## Invariants (full list in `docs/SDD.md`; enforced by `agents/frontend-review`)
- Single `state = {furniture, zones, rects, employees, depts}`; mutate via
  `pushUndo()` + `markDirty()`; never persist `EP`/roam into `state`.
- **Two renderers over one state:** Canvas-2D (`draw2D`, default) and Three.js 3D.
  Handle new geometry/interactions in **both**; `sync*` no-op in 2D; set `dirty2d=true`
  when the 2D picture changes.
- View transform is rotation/flip aware (`w2s/s2w/project`, `view2.rot/flip`).
- Roaming uses the ephemeral `EP` map; a **seat is optional** (unseated people wander).
- Content scale `CS` scales furniture + people together — keep it consistent.
- Don't rely on `requestAnimationFrame` running (it pauses in a hidden tab).

## Deploy
Frontend-only change → copy the file, no rebuild (`/deploy` skill). Backend change
(`api/` touched) → `docker compose up -d --build`. HR access code is `EDIT_TOKEN` in
the server `.env` (not in the repo).
