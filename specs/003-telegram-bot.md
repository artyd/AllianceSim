# 003 — Telegram bot: self-service characters, daily check-in, phone notifications

- **Status:** planned
- **Commit(s):** <hash once merged>
- **Date:** 2026-09-23

## Intent
Let office staff create and own their office character from a Telegram bot: on
`/start` they fill the same fields as the employee form (step-by-step via inline
menus), appear in the office immediately, then each workday morning get a short
check-in (status + mood) that updates their character. The website phone is wired
to the bot one-way: messaging/calling/marking a colleague on the site sends them a
Telegram notification.

## Requirements

### Characters (bot ↔ office)
- `/start` walks the user through **all form fields**: name, department, position,
  email, phone, ext, **photo _or_ colour avatar**, status, mood — each as an inline
  step; optional fields skippable.
- Bot is **open to everyone** (no invite gate). Anti-spam: one character per Telegram
  user; re-`/start` edits the existing character.
- A user can **create new _or_ claim an existing** unclaimed employee (matched by
  name). Claim links their Telegram id to that record.
- New characters are **unseated** — they free-roam (existing `seat:null` behaviour).
  HR may seat them later in the builder.
- Photo sent to the bot becomes the avatar; skipping yields the colour+initials
  avatar (same `avHTML` rendering the site already uses).

### Daily check-in
- Sent **weekday mornings** at a configurable time in **Europe/Kyiv** (default 09:00),
  Mon–Fri only.
- Inline survey updates the employee's **status** (`office | remote | absent | sick |
  vacation`) and **mood** — the exact enums the form/`STATUS` already use.
- Change reflects on the site (next poll) without an HR action.

### Phone → Telegram notifications (one-way)
- When someone on the site **messages, calls, or "marks/finds"** an employee whose
  character is bot-linked, that employee gets a **Telegram notification**.
- One-way only: replies happen in Telegram between people; nothing returns into the
  site phone chat. The site phone chat stays a local demo except that the *send /
  call / find* actions now also POST a notification event.

### Data ownership
- **People move out of the layout blob into the `employees` table** (source of truth);
  the site **reads employees from `/api/employees`** and writes employee changes there.
- The layout blob (`office_layout`) keeps only **furniture, zones, rects, depts** —
  HR-owned. Seat bindings (`desk_id` → furniture uid) live on the employee row.
- One-time migration: on first boot, import any `state.employees` already in the blob
  into the table, then stop persisting `employees` inside the blob.

### Out of scope
- Two-way site⇄Telegram chat (only notifications this round).
- Invite codes / HR approval gate (bot is open).
- Seat auto-assignment by the bot.
- Multi-language (bot is **Ukrainian** only).

## Design & decisions

### Runtime / hosting
- New **separate service** `bot/` (Node, ESM, `grammy`) in `docker-compose.yml`
  alongside `api`, on the same Postgres. **Long polling** (no public webhook / Caddy
  route). Env: `TELEGRAM_BOT_TOKEN`, `EDIT_TOKEN` (to call the API), `DATABASE_URL`,
  `CHECKIN_HOUR` (default 9), `CHECKIN_TZ=Europe/Kyiv`. Daily job via `node-cron`.
- Bot token comes from **@BotFather** — user supplies it into the server `.env`
  (prerequisite; not in repo).

### Backend (`api/`)
- **Expand `employees` schema** to carry all character fields:
  `position, email, phone, ext, photo (text/base64), color, status, mood,
  telegram_id (bigint unique, nullable), seat_i (int, nullable)`. Keep existing
  `name, department, desk_id`. `desk_id`+`seat_i` = the `{f,i}` seat.
- Endpoints: extend `GET/POST/PUT /employees` for the new fields; add
  `GET /employees/by-telegram/:tgId`, and `POST /notifications` (site → queue a
  Telegram send; bot drains or api calls Telegram directly — **decision: api writes a
  `notifications` row, bot polls & sends**, so the site never needs the bot token).
- Employee writes stay `requireEditToken`; the bot uses `EDIT_TOKEN`. Notifications
  POST from the public site needs a lighter guard (rate-limit + only valid employee
  id) — **open item, see below.**

### Frontend (`public/index.html`) — the risky part
- On load: fetch `/api/employees` → populate `state.employees`; furniture/zones from
  `/api/layout` as today. **Poll `/api/employees` every ~12 s** to reflect bot changes
  (new people, daily status/mood) live; merge without stomping in-flight EP roam state.
- Reroute employee mutations (add/edit/delete/seat/unseat/status/mood — lines ~1160,
  1192–1217, 1054) from blob-`markDirty()` to the corresponding `/api/employees` call,
  then update local `state.employees`. Keep `pushUndo` UX where cheap.
- Stop writing `employees` into the blob on `apiLayoutPut`; strip it in the payload.
- Both renderers: employee changes already flow through `syncAvatars/renderPeople/
  renderLabels` + `dirty2d=true`; keep that. No new geometry, so `CS` unaffected.
- Phone: `send`/`call`/`find` handlers additionally `POST /api/notifications`
  `{employeeId, kind, text}` (fire-and-forget).

### Invariants respected
- Single `state`; `EP`/roam stay ephemeral and never persisted. Two renderers over one
  state. Unseated people wander. Don't rely on rAF (poll uses `setInterval`).

## Resolved decisions
1. **Claim verification** — **no verification**; claiming an unclaimed name links it to
   the Telegram id. HR sees a "прив'язано через TG" badge on such cards. (Internal tool.)
2. **Notifications auth** — `/api/notifications` is **open but rate-limited per IP**
   (e.g. ~5/min); accepts only a valid employee id. No token needed from the site.
3. **Live-refresh** — site **polls `/api/employees` every ~12 s** (no SSE this round).

## Prerequisite (user)
- Create the bot via **@BotFather**, put the token into the server `.env` as
  `TELEGRAM_BOT_TOKEN`. The bot service won't start without it.

## Tasks
- [x] api: migrate/expand `employees` schema (+`notifications` table); blob→table import.
- [x] api: extend employee endpoints; add `by-telegram`, `linked`, `notifications`.
- [x] frontend: load+poll employees from API; reroute all employee mutations; drop
      employees from blob payload; TG-linked badge.
- [x] frontend: phone send/call/find → POST notification.
- [x] bot: `bot/` service (grammy, polling), step-by-step `/start` create+claim,
      photo/colour avatar, edit on re-start.
- [x] bot: weekday check-in cron (Kyiv), status+mood inline update.
- [x] bot: drain `notifications` and deliver to Telegram.
- [x] compose: add `bot` service; DEPLOY.md: BotFather token + env.
- [ ] verify (browser offline + invariants review); integration test on server with token.

## Verification
- Syntax hook green on every `public/index.html` save.
- `app-verify`: site loads people from API (no console errors); adding/editing/seating
  a person persists via API and survives reload; a row changed directly in the DB
  appears on the site within ~12 s.
- Bot (staging token): `/start` creates a character that shows up on the site; re-start
  edits it; claim links an existing name. Trigger check-in manually → status/mood update
  visible on site. Site "message/call/find" → Telegram notification arrives.
- Backend smoke tests (curl) for the expanded endpoints, mirroring `deploy/DEPLOY.md §3`.
