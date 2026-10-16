# 007 — Phone+: day screen, search, rooms, statuses, polls, pulse, onboarding, PWA, mini-games

**Status:** in progress · decided with the product owner on 2026-10-16 (survey answers below).

## Scope (13 improvements + games)
1. **Telegram actions** — invite/task buttons exist; add game invites (Прийняти/Відхилити) and poll voting from the bot.
2. **Spotlight search** — one field on the home screen: colleagues, chats, messages, events (next 60 days), tasks.
3. **Free rooms now** — sheet from Control Center/home: meeting rooms free now (until when), book 30/60 min in one tap.
4. **«Мій день»** — once a day on first open: greeting, meetings, tasks due, teammates in the office, birthdays, pulse, onboarding.
5. **«Хто поруч»** — colleague card: distance to their seat, same room, «Показати на плані».
6. **Status with timer** — note + until («На обіді · до 14:00», «Фокус · 2 год»); auto-reset; Focus mutes Telegram pings.
7. **Polls in announcements** — 2–6 options, live results, vote in app or from Telegram.
8. **Coffee** — «Як зазвичай» (repeat last order), recent orders, «Принесли» to finish the island.
9. **Pulse** — one anonymous question a week (HR sets it, default list rotates), answers 1–5; HR sees averages only for groups of ≥3.
10. **Onboarding** — HR template; newcomers (hired_on within 30 days) get a checklist with progress; HR sees progress.
11. **Offline** — last chats/tasks/events cached; «Немає зв’язку» indicator.
12. **Accessibility** — every icon-only control labelled; audit rule; contrast checked in dark.
13. **PWA** — manifest + icons + service worker (network-first) for the website.

## Mini-games (owner’s answers)
- Games: Хрестики-нулики, Морський бій, Шашки (Ukrainian rules), Шахи (full rules), Вікторина про офіс (2–8, bots fill seats), solo 2048, Змійка, Слово (UA Wordle).
- Bots: 3 levels (Легкий/Середній/Сильний) for duels; quiz bots answer with level-based accuracy.
- Lobby size depends on the game (duels 2, quiz 2–8).
- **Invites**: host picks colleagues **online now** → a game card in the 1:1 chat with Прийняти/Відхилити + a Telegram message with the same buttons + in-app island banner.
- **Leaderboard** of the office (week / all time): PvP wins, quiz points, solo records. Not part of HR analytics.
- **HR switch**: games on/off + allowed time windows (default: always).

## Protocol
- `games` row = room: `kind, host_id, status (lobby|active|done|cancelled), players[{id|bot,name,state}], state jsonb, seq`.
- Duels: state is client-defined JSON; server enforces membership, `seq` (optimistic concurrency) and `state.turn` (player index; null = simultaneous phase). Final move carries `result {winner|draw}` → scores.
- Quiz is server-run (timers, hidden answers, bots).
- Bot/solo games run on the device; results posted to `/me/games/result` for records.

## Invariants
Nothing new in the layout `state`; all personal data under `/me/*` scoped to `req.me`; HR config in `office_kv`.
