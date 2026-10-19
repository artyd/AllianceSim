# Issue tracker: local markdown in `docs/specs/`

Work for this repo is tracked as markdown files committed next to the code (ADR-0008). There is no GitHub Issues workflow.

## Conventions

- **Spec** = one feature: `docs/specs/NNN-<slug>.md`, numbered after the highest existing `NNN`, written from `docs/specs/_template.md` (the `/spec` skill does this). The `Status:` line at the top is `planned | in-progress | done`; `Commit(s):` gets the hash once merged.
- **Tickets** for a spec, when a spec is split up: `docs/specs/NNN-<slug>/NN-<slug>.md`, numbered from `01`, one file per ticket. A `Status:` line near the top holds the triage role (see `triage-labels.md`); a `Blocked by: NN, NN` line lists blockers.
- Comments and history append under a `## Comments` heading at the bottom of the file.

## When a skill says "publish to the issue tracker"

Write a new spec file (or ticket files under the spec's folder) as above. `/to-spec` writes `docs/specs/NNN-<slug>.md`; `/to-tickets` writes `docs/specs/NNN-<slug>/NN-*.md`.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path; the user normally gives the spec number (e.g. "spec 008") or a path.

## Wayfinding operations

Used by `/wayfinder` for work bigger than one session.

- **Map**: `docs/specs/<effort>/map.md` (Notes / Decisions-so-far / Fog).
- **Child ticket**: `docs/specs/<effort>/NN-<slug>.md` with a `Type:` line (`research`/`prototype`/`grilling`/`task`) and `Status:` (`claimed`/`resolved`).
- **Blocking**: `Blocked by: NN, NN`; a ticket is unblocked when every listed file is `resolved`.
- **Frontier**: open, unblocked, unclaimed files in the effort folder; lowest number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under `## Answer`, set `Status: resolved`, and add a one-line pointer to `map.md` → Decisions-so-far.
