# Skills

Project skills for Claude Code. Two groups:

- **AllianceSim's own:** `spec` (SDD spec from the template), `serve` (local static server), `deploy` (production runbook).
- **[mattpocock/skills](https://github.com/mattpocock/skills)** (MIT), copied at commit `49dd158` (2026-10-09) — everything from `skills/engineering` and `skills/productivity`, without the Codex-only `agents/` folders.
  Renamed to avoid Claude Code built-ins (folder + `name:` + cross-references): `code-review` → `mp-code-review`, `research` → `mp-research`, `prototype` → `mp-prototype`.
  Start with `/ask-matt` if unsure which one fits. Per-repo config lives in `docs/agents/`.

**Updating the copied pack:** clone the upstream repo, re-run the copy with the same three renames, then diff against this folder and keep any local edits.
