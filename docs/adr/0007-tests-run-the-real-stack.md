# Tests run the real stack, no mocks

`tests/` starts the real api on an embedded Postgres, the real bot against a fake Telegram Bot API, and the real site in headless Chrome as faked Telegram users (signed `initData`). Playwright audits layouts on phone and web sizes. Mocks of our own code were rejected: the bugs that hurt were in the seams (SQL, auth headers, Telegram payloads, CSS).

## Consequences

- Every new feature adds a scenario under `tests/api` (HTTP + bot) or `tests/ui` (browser); `cd tests && npm test` must be green before a commit.
