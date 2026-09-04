# AllianceSim — Specification-Driven Development (SDD)

Specification-Driven Development turns a chaotic back-and-forth with an AI into a
**structured process**: you write down *what* you want (a spec), *plan* the change,
*implement* it in small verified steps, and *verify* it works — then commit. The
history stops being a scroll of chat and becomes a set of specifications you can
read, review, and build on.

This document has two parts:
1. **The method** — the loop and how this repo's harness supports it.
2. **The project's spec history** — everything built from the first commit to today,
   reconstructed as compact specs.

---

## 1. The method

### The loop

```
Specify  →  Plan  →  Implement  →  Verify  →  Commit
   ↑                                            │
   └──────────────  (next spec)  ───────────────┘
```

- **Specify** — for anything non-trivial, write a short spec in `specs/` (use the
  `/spec` skill and `specs/_template.md`): *Intent · Requirements · Design & decisions
  · Tasks · Verification*. Half a page. It is a living doc — update it if the design
  changes while building.
- **Plan** — use **plan mode** (or a Plan agent) to design the approach against the
  actual code before editing. Read the invariants (below) first; prefer reusing
  existing helpers over new code.
- **Implement** — small, focused edits. The whole frontend is one file
  (`public/index.html`), so changes are surgical. After every save the **syntax hook**
  runs automatically.
- **Verify** — parsing is not proof. Serve the app (`/serve`) and drive it in the
  browser with the **`app-verify`** agent; a clean change reports **no console errors**
  and the behaviour is observed, not assumed. Roaming/animation is stepped
  deterministically with a temporary `window.__step` hook because `requestAnimationFrame`
  pauses in a backgrounded tab.
- **Commit** — one change, one commit, with the spec status updated.

### How the harness supports it (`.claude/`)

| Stage | Support |
|---|---|
| Specify | `skills/spec` + `specs/_template.md` |
| Plan | plan mode; `agents/frontend-review` for a design/second read |
| Implement | `hooks` → `scripts/check-html.mjs` syntax-checks `public/index.html` on every Edit/Write |
| Verify | `skills/serve` + `scripts/serve.cjs`; `agents/app-verify` (browser + console) |
| Ship | `skills/deploy` (frontend file copy; backend rebuild only if `api/` changed) |

### Architecture invariants (the "spec of the spec")

These hold across all features; every change is reviewed against them (see
`agents/frontend-review.md`):

- **One source of truth:** `state = {furniture, zones, rects, employees, depts}`,
  saved as a JSON blob to `PUT /layout` (token-gated) with a `localStorage` fallback.
- **Two renderers, one state:** a lightweight **Canvas-2D** top-down view (default,
  `draw2D`) and an optional **Three.js 3D** scene; `view ∈ {'2d','3d'}`. New geometry
  and interactions must be handled in **both** paths. `sync*` build 3D objects and
  no-op in 2D.
- **View transform is rotation/flip aware:** `w2s/s2w/project` use `view2.rot`,
  `view2.flip`, `ROTC/ROTS`; default orientation puts the entrance (Кімната 1) top-right.
- **Roaming lives outside `state`:** an ephemeral `EP` map holds live positions;
  `updateRoam` drives seated and unseated people; a seat is **optional**.
- **Content scale `CS`** multiplies furniture geometry, footprints, seats, avatars,
  and 2D dots together, so collision/seating/roaming stay coherent.
- **Repaint gating:** anything that changes the 2D picture sets `dirty2d=true`.
- **Don't depend on a live animation frame** (rAF pauses when the tab is hidden).

---

## 2. Project spec history (first commit → today)

AllianceSim is an office floor-plan tool for HR: build the layout (rooms, furniture,
zones), seat or free-roam colleagues, and share a read-only link. Frontend is one
file `public/index.html`; backend is Express + Postgres in `api/`, deployed with
Docker + Caddy. Below, each epic is a compact spec.

### 001 — MVP backend + infrastructure  ·  `cf42501`  ·  2026-09-02
- **Intent:** a minimal server to persist one office layout and its employees.
- **Requirements:** singleton `office_layout` (jsonb); `employees` table; public
  reads; writes require `X-Edit-Token == EDIT_TOKEN`; Dockerized Node + Postgres
  behind Caddy (HTTPS), loopback port 8011.
- **Decisions:** schema embedded in `api/src/db.js` (Docker build context is `./api`);
  fail-closed writes if no token configured; router mounted at both `/` and `/api`.
- **Verify:** `curl /health`, layout PUT/GET, 401 on bad token (see `deploy/DEPLOY.md`).

### 002 — 3D office frontend, wired to the API  ·  `5669c74`, `a045f66`, `9d36500`, `999a4d7`  ·  2026-09-02
- **Intent:** a usable builder/viewer UI over the API.
- **Requirements:** import the real 3D office; drag-drop furniture; assign zones;
  seat employees; save to the backend with offline fallback; GLB avatars
  (sit/stand/walk); professional look (Font Awesome icons; redesigned settings panel
  with clear labels).
- **Decisions:** whole app in one page; `state` blob; Three.js via import map; token
  entered once and kept in `localStorage`.

### 003 — Lightweight 2D mode + moods + zone departments + viewer lock + redesign  ·  `2469815`  ·  2026-09-03
- **Intent:** run well on weak devices and read like a real plan; make HR/viewer flows clear.
- **Requirements:** a genuine **Canvas-2D top-down renderer** (no WebGL) as the
  **default**, with full editing parity and a 2D/3D toggle; mood **emojis over heads**
  (kept as smileys); **department presets** for zones (Закупівлі/Логістика, IT,
  Бухгалтерія/Фінанси, Юристи, Продажі, HR, Кабінет Ольги/Руслана); **hard viewer
  lock** on `?mode=viewer`; redesign the employee form/card and dock panels to the
  settings-panel style; a simple HR access code flow.
- **Decisions:** guard `sync*` to no-op in 2D so GLB/avatars aren't built; `project`
  becomes view-aware so HTML overlays work in both modes.

### 004 — 2D horizontal, grid, WASD, colour picker, office-wide roaming  ·  `ab067c2`  ·  2026-09-03
- **Requirements:** office reads **landscape**; floor **grid**; **WASD/arrow** camera
  pan; **per-zone custom colour** (distinct per department) + compact popover;
  avatars **walk the whole office** (door-gap detection + corridor waypoints), in 2D and 3D.
- **Decisions:** ephemeral `EP` roaming map shared by both renderers; verified with a
  stepped simulation because rAF pauses when backgrounded.

### 005 — Rotate/mirror controls; popover fixes; canonical orientation  ·  `0805ccc`, `eb266c4`, `6f54a7c`  ·  2026-09-03
- **Requirements:** on-canvas **rotate 90° / mirror** controls (snapped); zone popover
  never scrolls horizontally and its name field can't overflow (`min-width:0`); the
  plan **always opens** with the entrance (by Кімната 1) in the **top-right**.
- **Decisions:** generalise the 2D transform to `rot ∈ {0..3}` + `flip`; keyboard/mouse
  pan in screen space (stays intuitive after rotation); a reload returns to the
  canonical orientation.

### 006 — Seat is optional; roaming un-stick; edit/delete/unbind  ·  `dbfa126`, `37937b8`  ·  2026-09-03
- **Requirements:** an in-office employee needs **no desk** — unassigned people spawn
  and **wander endlessly**; binding a seat is an optional anchor. Avatars **never get
  stuck** on walls. Employee cards get **edit / delete / unbind** actions.
- **Decisions:** progress-based re-routing (re-pick a target when not getting closer);
  two-pass `stepAvoid` (walls always respected, furniture only in the strict pass so
  they can leave a desk); `syncAvatars`/`draw2D`/`focusEmployee` handle the no-seat case.

### 007 — Content scale tuning  ·  `4d9c846` → `ec48539`  ·  2026-09-03
- **Requirements:** furniture and people read too small in the large rooms — scale
  them up together. Tried **2.5×** (too large), settled on **1.5×**.
- **Decisions:** a single `CS` constant applied to geometry, footprints, seats,
  avatars, 2D dots, and the modal preview camera; catalog labels show real (un-scaled) sizes.

### 008 — Harness kit + this SDD documentation  ·  (this change)  ·  2026-09-04
- **Intent:** capture the workflow and the specs so future work is structured, not ad-hoc.
- **Deliverables:** `.claude/` (syntax-check hook, `serve`/`deploy`/`spec` skills,
  `frontend-review`/`app-verify` agents, permissions), `specs/_template.md`, root
  `CLAUDE.md`, and this document.

---

## Current state (2026-09-04)
- 2D top-down is the default, light renderer; 3D is opt-in. Horizontal layout, grid,
  rotate/mirror, WASD/mouse pan, canonical entrance-top-right orientation.
- Employees roam the whole office by default; seating is an optional anchor; cards
  support edit/delete/unbind; moods are emojis over heads (2D + 3D).
- Zones carry department names and custom colours; compact popover.
- Viewer share link is a hard read-only lock; HR saves with the `EDIT_TOKEN` code.
- Content scaled 1.5×.

## Backlog / open ideas
- **Model quality (img2threejs):** rebuild specific furniture/avatar models from
  reference images for a more premium 3D look (needs a reference image per model;
  best done one model at a time). Low priority while 2D is primary.
- Per-person HR auth / audit trail (currently one shared `EDIT_TOKEN`).
