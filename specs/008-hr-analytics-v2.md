# 008 — HR analytics v2 (web + Mini App + Excel/PDF reports)

- **Status:** done
- **Commit(s):** ef49db8
- **Date:** 2026-10-19

## Intent
The «Аналітика» tab is one fixed 30-day page (4 tiles, mood line, remote bars, quiet list).
HR (Тахтаулова, Свистельник) needs a professional working tool: filters, comparison,
drill-down to a person, a timesheet, exports, the same analytics in the Telegram Mini App,
and weekly/monthly reports delivered to Telegram.

## Requirements
- **Filters (shared by all sections):** period 7 / 30 / 90 days or a custom range; department
  (all or one); every KPI shows Δ vs the previous period of the same length (▲▼).
- **Sub-tabs:** Огляд · Присутність · Настрій · Залученість · Люди.
  - **Огляд:** KPI tiles (in office today, remote, avg mood, check-in rate, pulse, headcount)
    + «Потребують уваги» list.
  - **Присутність:** daily stacked status chart (office/remote/absent/sick/vacation — the statuses people pick), office load
    by weekday, remote share by dept, **timesheet** people × days (coloured cells, weekends
    grey, per-person totals by status, sticky name column, horizontal scroll).
  - **Настрій:** daily avg trend, answer distribution, avg by dept; weekly **pulse** —
    stays anonymous (avg only for groups ≥ `PULSE_MIN_GROUP`, as promised to employees).
  - **Залученість:** check-in response rate (daily + by dept), pulse response rate by week.
  - **Люди:** headcount by dept, newcomers + onboarding progress, tenure buckets,
    birthdays/anniversaries in the next 30 days.
- **Person card** (click a name anywhere): status timeline for the period, personal mood
  by day (HR sees personal mood — owner decision), check-in rate, onboarding progress.
  Personal pulse answers are never shown.
- **«Потребують уваги»** (workdays Mon–Fri; vacation/sick days don't count):
  no check-in for 5+ workdays · mood tired/stressed on 3 answers in a row ·
  last-7-day avg ≥ 1.0 below the person's previous-30-day avg (≥ 3 answers in each).
- **Export:** Excel (.xlsx: Огляд, Табель, Настрій, Залученість, Люди sheets) and PDF
  (one-page-per-section report with charts) for the current filters.
- **Mini App:** app «Аналітика» on the phone home screen, visible only to HR; same sections
  and filters, mobile layout; export buttons send the files to the user's chat with the bot.
- **HR in Telegram:** `HR_NAMES` (comma list, matched like `COFFEE_HR_NAME`) and/or
  `HR_TG_IDS` in `.env`. Web keeps the `EDIT_TOKEN` code.
- **Reports:** bot sends Excel + PDF + a short summary message with an «Відкрити аналітику»
  button to every HR: weekly Mon 10:00 (previous Mon–Sun), monthly on the 1st 10:00
  (previous calendar month), Europe/Kyiv.
- **Out of scope:** public holidays calendar, manager-level (per-dept) access, chat/game/event
  activity metrics, editing data from analytics.

## Design & decisions
- **API** — new `api/src/analytics.js` router; data from `daily_snapshots`, `employees`,
  `pulse_answers`, `onboarding_done`. Old `GET /analytics` stays (tests/back-compat).
  - Auth `requireHR`: `X-Edit-Token` **or** a verified Telegram session whose employee
    matches `HR_NAMES`/`HR_TG_IDS`. `GET /me/hr` → `{hr:bool}` for the phone.
  - `GET /analytics/v2?from&to&dept` → `{range, prev, kpi, attention, presence, mood,
    pulse, engagement, people}`; `GET /analytics/person/:id?from&to`;
    `GET /analytics/export.xlsx|.pdf?from&to&dept`; `POST /me/hr/export` (Mini App →
    the bot API sends the files to the caller).
  - `exceljs` for xlsx, `pdfkit` (vector charts, DejaVu font — add `font-dejavu` to the api
    Dockerfile) for PDF. Check current APIs with Context7 before coding.
  - `GET /analytics/hr-recipients` (token) — the bot's report list. Mood counts only answered
    days (`checked_in`); presence/check-in rates use workdays (Mon–Fri) only.
  - `docker-compose.yml` passes `HR_NAMES` (default «Тахтаулова,Свистельник»), `HR_TG_IDS` to the
    api and `ANALYTICS_REPORT_HOUR` to the bot.
- **Shared frontend module `public/analytics.js`** — data fetching, SVG charts (line, stacked
  bars, h-bars, heat timesheet), section renderers, person card; used by `index.html`
  (sidebar tab, wide layout) and `phone.js` (HR app). One implementation, two shells;
  colours via theme tokens (`--viz*`) so dark mode works in both. Charts are placeholders with a
  JSON spec, painted at the container's real width (text keeps its CSS size) and repainted by a
  ResizeObserver. Filters/tab persist in localStorage (try/catch). Web: «на весь екран» toggle;
  the old HR tools (pulse question, onboarding template, games) moved into a collapsible block.
- **Mini App:** the icon appears after `GET /me/hr` says `hr:true`; deep link `?open=analytics`
  (the bot's «Відкрити аналітику» button). «Excel + PDF у чат» queues an `hr_export`
  notification; the bot marks it sent first, then builds and sends the files.
- **Bot:** two `node-cron` jobs; files fetched from the api with `EDIT_TOKEN`, sent with
  `sendDocument` (`InputFile`). Recipients resolved from the same HR env vars.
- Office plan renderers (2D/3D), `state`, `CS` — untouched.

## Tasks
- [x] A. API: `requireHR` + `/me/hr`, `/analytics/v2`, person, attention rules; unit/api tests
- [x] B. Export: xlsx + pdf endpoints (exceljs, pdfkit, DejaVu); test files open/parse
- [x] C. `public/analytics.js` + web sub-tabs, filters, timesheet, person card, export buttons
- [x] D. Mini App «Аналітика» app (HR only) + export-to-chat
- [x] E. Bot: weekly + monthly reports to HR
- [x] F. Games fixes from this session (sea dark ships, fixed board cells) ride along
- [x] G. Docs: `.env` vars in `deploy/DEPLOY.md`; memory; spec status

## Verification
- `cd tests && npm test`: new api scenarios (HR auth via token / HR Telegram user / non-HR
  user → 403; v2 numbers on fixture snapshots; attention rules; xlsx parses; pdf starts `%PDF`),
  bot scenario (cron handler sends 2 documents + message to the HR chat on the fake Bot API),
  Mini App scenario (HR user sees the app, non-HR doesn't).
- `npm run test:pw`: analytics tab + Mini App app on phone and web sizes, light/dark, no overflow.
- `app-verify` in the browser: switch periods/departments/sub-tabs, open a person card,
  download both exports; **no console errors**.
- Deploy: api + bot rebuild (`docker compose up -d --build`), new `.env` vars.
