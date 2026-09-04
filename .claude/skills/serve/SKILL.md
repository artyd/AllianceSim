---
name: serve
description: Run the AllianceSim frontend locally for manual or browser testing. Serves public/ on http://localhost:5055 with no backend required (the app falls back to localStorage when /api is unreachable). Use before verifying a UI change in the browser.
---

# Serve the app locally

Start the static server (background) and confirm it's up:

```bash
node .claude/scripts/serve.cjs public 5055 &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5055/   # expect 200
```

Then open **http://localhost:5055/** (or drive it with the Claude-in-Chrome tools /
the `app-verify` agent).

Notes:
- No API needed for UI testing — writes go to `localStorage` when `/api` is down.
- Change the port by passing a different second arg: `node .claude/scripts/serve.cjs public 5056`.
- To stop it: `pkill -f serve.cjs` (or close the background task).
- `?mode=viewer` opens the read-only share view; the default is builder/2D.
