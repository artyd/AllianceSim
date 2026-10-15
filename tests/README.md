# Tests

Integration tests that run the **real** api / bot / Mini App locally — no Docker needed.

```bash
cd tests && npm install
npm test            # everything
npm run test:api    # api/*  — each file: fresh embedded Postgres + api (05 also runs the bot)
npm run test:ui     # ui/*   — devstack + headless Chrome (set CHROME=/path if not found)
node run.mjs api chats   # filter by file name
```

- `harness.mjs` — embedded Postgres + api process, signed Telegram `initData`, assert helpers.
- `devstack.mjs` — persistent stack for browser tests: serves `public/`, proxies `/api`,
  seeds 4 people (3 linked to Telegram), `/__reset` wipes personal data between scenarios,
  optional office plan from `fixtures/layout.json`. Run it by hand (`STACK=dev node devstack.mjs`)
  and open the URLs in `.tmp/urls.json` to click around as a Telegram user.
- Telegram is faked: the Mini App reads `#tgWebAppData=…` (signed with a test bot token);
  the bot talks to a fake Bot API via `TELEGRAM_API_ROOT`.
- All tokens here are test values; nothing real is needed or used.
