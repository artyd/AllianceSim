# AllianceSim

Office tool for HR at Альянс Груп 95: a floor plan of the office with live colleagues on it, plus a
personal phone (Telegram Mini App) for every employee. Terms below are what code, specs and
conversations use; the Ukrainian name is the one shown in the UI.

## Office plan

**Office plan** (План офісу):
The one `state` blob `{furniture, zones, rects, employees, depts}` that HR builds and saves to `PUT /layout`.
_Avoid_: layout (only as the API route name), map, scene

**Builder mode** (Будівник):
The HR editing mode of the site, unlocked by the HR code.
_Avoid_: edit mode, admin mode

**Viewer mode** (Перегляд):
Read-only mode of the site; forced by `?mode=viewer` and inside the Mini App.

**HR code** (Код доступу):
The shared `EDIT_TOKEN` secret that unlocks builder mode and HR endpoints from the web.
_Avoid_: password, admin token

**Room** (Кімната):
A walled rectangle of the plan (`rects`); walls and door gaps steer roaming.

**Zone** (Зона):
A coloured area of the plan assigned to a department.

**Department** (Відділ):
A team name on an employee and a zone; also the grouping for chats and analytics.
_Avoid_: team, division

**Seat** (Місце):
A chair slot of a desk an employee may be bound to; optional.

**Content scale** (`CS`):
The single factor that scales furniture and people together on the plan.

**Roaming**:
Live walking of characters across the plan, held in the ephemeral `EP` map, never in the office plan.
_Avoid_: animation, movement

## People

**Employee** (Співробітник):
A person row in the `employees` table — the source of truth for people since spec 003.
_Avoid_: user, member, staff

**Character** (Персонаж):
An employee as drawn on the plan (avatar, mood emoji, status).

**Linked employee**:
An employee whose `telegram_id` is set, so they have a personal phone and get bot messages.
_Avoid_: registered, connected user

**Status** (Статус):
Where an employee works today: office · remote · absent · sick · vacation (В офісі · З дому · Немає в офісі · Хворію · У відпустці).

**Status note**:
A short free-text status with an optional expiry (e.g. «Фокус» mutes optional pings).

**Mood** (Настрій):
Today's self-reported mood: great · good · ok · tired · stressed, scored 5…1.

**Check-in** (Ранковий опитувальник):
The weekday-morning bot question that sets an employee's status and mood; answering it marks the day as checked in.

**HR**:
The people who see analytics and get HR reports — the HR code on the web, `HR_NAMES`/`HR_TG_IDS` in Telegram.

## Phone

**Phone** (AllianceOS):
The phone-shaped UI (`public/js/phone/`): a demo on the site, the personal phone inside the Mini App.

**Mini App**:
The site opened from the Telegram bot; it verifies Telegram `initData` and acts as the linked employee.
_Avoid_: web app, TMA

**Personal app**:
A phone app whose data is the caller's own (`/me/*` routes): chats, calendar, tasks, desk, profile.

**Announcement** (Оголошення):
A broadcast message into the office or a department chat, optionally with a poll.

**Hot desk** (Моє місце):
A bookable desk for a day.

**Game** (Гра):
A two-player duel (tic-tac-toe, battleship, checkers, chess) or a solo game (2048, snake, word); duels start from a **lobby** invite.

**Quiz** (Вікторина):
A multi-player round of questions run by the server with optional bots.

## HR analytics

**Snapshot**:
One row per employee per day in `daily_snapshots` (department, status, mood, checked-in) — the history analytics is built from.

**Pulse** (Пульс тижня):
The weekly anonymous 1–5 question; averages are shown only for groups of at least `PULSE_MIN_GROUP` people.
_Avoid_: survey, poll (a poll is part of an announcement)

**Onboarding** (Онбординг):
The newcomer checklist shown for 30 days after `hired_on`.

**Attention signal** (Потребують уваги):
A flag on an employee: no check-in for 5+ workdays, three low moods in a row, or a weekly mood drop of 1+.

**Timesheet** (Табель):
People × days grid of statuses with per-status totals over workdays.

**HR report**:
A bot message to HR: the daily office card, or the weekly/monthly analytics summary with Excel + PDF.

## Delivery

**Notification**:
A row queued by the api for the bot to deliver to a linked employee's Telegram (`/notifications/pending`).
_Avoid_: push, message (a message is a chat message)

**Spec**:
A half-page feature document in `docs/specs/NNN-slug.md` — the unit of work in this repo's SDD loop.
