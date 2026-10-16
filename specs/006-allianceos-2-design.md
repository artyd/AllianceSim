# 006 — AllianceOS 2.0 design (iOS 26 × Material 3)

**Status:** implemented (part A — visual layer + home). Mockup: https://claude.ai/artifact/JKK3EM5KmduGFDH9x4Vmsy

## Goal
Modern phone look for the Mini App and the office phone frame, from a 30-question survey (2026-10-16).

## Done (part A)
- Design tokens scoped to `#phone` (light + `data-ui="dark"`), system font, accent #E2001A; theme follows Telegram `colorScheme`.
- Home: brand-gradient wallpaper; widgets (next meeting today, my tasks, my status + mood, unread chats); 4-column squircle gradient icons; glass dock (Чат, Дзвінки, Календар with live date, Задачі).
- Dynamic Island: shows the next meeting within 60 min with a countdown; tap opens the calendar.
- Status bar hidden inside Telegram; zoom-from-icon app transition; HapticFeedback on app open.
- App chrome: compact glass headers, inset-grouped rows, iOS toggles, iMessage bubbles.
- Glass falls back to solid fills on weak devices / `prefers-reduced-transparency` (`#phone[data-reduce]`).

## Later (part B)
Lock screen + Control Center in the office frame, large collapsing titles, floating tab bars, bottom-sheet forms, wallpaper picker in Settings.

## Invariants
Pure view layer: nothing new goes into `state`; widgets read `PM` + `/me/events` only.
