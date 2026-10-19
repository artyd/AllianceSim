# 006 — AllianceOS 2.0 design (iOS 26 × Material 3)

**Status:** implemented (parts A + B — full mockup). Mockup: https://claude.ai/artifact/JKK3EM5KmduGFDH9x4Vmsy

## Goal
Modern phone look for the Mini App and the office phone frame, from a 30-question survey (2026-10-16).

## Done (part A)
- Design tokens scoped to `#phone` (light + `data-ui="dark"`), system font, accent #E2001A; theme follows Telegram `colorScheme`.
- Home: brand-gradient wallpaper; widgets (next meeting today, my tasks, my status + mood, unread chats); 4-column squircle gradient icons; glass dock (Чат, Дзвінки, Календар with live date, Задачі).
- Dynamic Island: shows the next meeting within 60 min with a countdown; tap opens the calendar.
- Status bar hidden inside Telegram; zoom-from-icon app transition; HapticFeedback on app open.
- App chrome: compact glass headers, inset-grouped rows, iOS toggles, iMessage bubbles.
- Glass falls back to solid fills on weak devices / `prefers-reduced-transparency` (`#phone[data-reduce]`).

## Done (part B)
- Lock screen in the office frame (clock, next meeting, notifications, swipe/tap to unlock).
- Control Center (pull down on home / tap the status bar): status, do-not-disturb (Telegram prefs), haptics, theme Авто/Світла/Темна, less glass, mood, quick tiles.
- Large collapsing titles, floating glass tab bars (Чати·Дзвінки·Контакти, Календар·Задачі), FAB, bottom sheets with «Скасувати · Title · action» + swipe-down.
- Island states: incoming message (tap → chat), voice recording timer, coffee in progress.
- Screens per mockup: chat filters, contacts with A–Я sections + status dots, profile/colleague hero, grouped Settings + wallpaper picker, calendar week strip + day timeline, tasks grouped by due, desk mini-map, coffee grid.
- UI scenario: tests/ui/10-os2-design.mjs.

## Invariants
Pure view layer: nothing new goes into `state`; widgets read `PM` + `/me/events` only.
