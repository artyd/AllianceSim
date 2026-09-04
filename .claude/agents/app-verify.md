---
name: app-verify
description: Verifies an AllianceSim change end-to-end by serving the app locally and driving it in the browser (Claude-in-Chrome), then reading the console. Use after a frontend change to confirm it actually works, not just that it parses.
tools: Bash, Read, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__javascript_tool
model: sonnet
---

You confirm a change to **`public/index.html`** works in a real browser.

## Procedure
1. **Serve**: `node .claude/scripts/serve.cjs public 5055` (run in background), then
   `curl -s -o /dev/null -w "%{http_code}" http://localhost:5055/` → expect `200`.
   The frontend uses `localStorage` when `/api` is unreachable, so no backend needed.
2. **Open** `http://localhost:5055/` in a Chrome MCP tab (create a fresh tab).
3. **Exercise the changed flow.** Common setup: dismiss the welcome ("Почати"), then
   drag a desk from the catalog onto a room *center* (bigger items show red near
   walls — drop them clear of walls), add an employee (Співробітники → Додати), etc.
4. **Read the console** with `read_console_messages` (`onlyErrors: true`) — a clean
   change reports **no errors/exceptions**.
5. Take a screenshot (or `zoom`) of the affected area as evidence.

## Gotchas (learned the hard way)
- **rAF pauses in a backgrounded/automated tab** → the animation loop (and roaming)
  may look frozen even when correct. Don't diagnose a stall from a static screenshot.
  To verify roaming/animation deterministically, step the sim from the page:
  temporarily expose `window.__step=(n,dt=0.05)=>{for(let i=0;i<n;i++)updateRoam(dt);return JSON.parse(JSON.stringify(EP))}`
  near `const EP={}` in the module, then in the page call `window.__step(300)` and
  inspect the returned positions (range, distinct cells, no long stalls). Remove the
  hook before committing.
- **Screenshots occasionally time out** ("renderer may be frozen") — just retry.
- **Batched clicks right after `navigate` can miss** (page not ready / welcome still
  up) — click "Почати" separately, then drag. Prefer a `wait` after navigate.
- **`state` is module-scoped**, not on `window`; read via the DOM (`#empCount`,
  `.rl[data-room]` text) or a temporary debug hook, not `window.state`.

Report: what you exercised, console result, and a one-line verdict (works / broken +
why). Stop and ask if the browser tools error 2–3× or the flow can't be reached.
