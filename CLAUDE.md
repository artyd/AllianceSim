# AllianceSim — project guide for Claude

Office floor-plan tool for HR: build the layout (rooms, furniture, zones), seat or
free-roam colleagues, share a read-only link.

## Shape
- **Frontend is one file: `public/index.html`** — HTML shell + `<style>` + one
  `<script type="module">` with all logic. No build step, no framework.
- **Backend: `api/`** (Express + Postgres). One `state` blob saved to `PUT /layout`
  (token-gated); public reads; `localStorage` offline fallback.
- Deployed with Docker + Caddy — see `deploy/DEPLOY.md`.

## How to work here (SDD loop — see `docs/SDD.md`)
1. For non-trivial changes, write a short spec first (`/spec`, `specs/_template.md`)
   and design in **plan mode**.
2. Edit `public/index.html` in small steps. A **PostToolUse hook** syntax-checks the
   module script automatically after each save
   (`.claude/scripts/check-html.mjs`) — fix any reported error before moving on.
3. **Verify in the browser** — don't trust parsing alone. Use `/serve`
   (`node .claude/scripts/serve.cjs public 5055`) and the **`app-verify`** agent;
   confirm **no console errors**.
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
