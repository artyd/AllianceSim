---
name: spec
description: Scaffold a Specification-Driven Development (SDD) spec for a new AllianceSim feature before implementing it. Use when a request is non-trivial (touches state, rendering, roaming, or the API) so intent, requirements, design and verification are written down first.
---

# Write a spec first (SDD)

Turn a request into a small spec, then implement against it. This is the "Specify"
step of the SDD loop documented in [`docs/SDD.md`](../../../docs/SDD.md).

## Steps
1. Pick the next number and a slug, copy the template:
   ```bash
   cp specs/_template.md specs/003-<slug>.md   # use the next free NNN
   ```
   (Numbers 001–002 and the history are already captured in `docs/SDD.md`; start new
   specs at 003+ unless you're back-filling.)
2. Fill it in:
   - **Intent** — one or two sentences: the problem and the desired outcome.
   - **Requirements** — bullet, testable ("employees without a seat wander the whole
     floor"). Note what is explicitly *out* of scope.
   - **Design & decisions** — key approach and trade-offs; name existing helpers to
     reuse (`fp`, `seatWorld`, `roomAt`, `fits`, `empPos`, `zoneColor`, `project`,
     `draw2D`, `updateRoam`). Remember: changes usually need both the 2D and 3D path,
     and the content scale `CS`.
   - **Tasks** — a short ordered checklist.
   - **Verification** — how you'll prove it: the syntax hook + `app-verify` in the
     browser (what to click, what console result), plus any `window.__step` roaming
     check.
   - **Status/Commit** — leave `planned`; fill the commit hash when merged.
3. Implement in **plan mode** for anything with real surface area, in small edits.
   The PostToolUse hook syntax-checks `public/index.html` on every save.
4. Verify with the `app-verify` agent, then commit and set the spec's status.

Keep specs short (half a page). They are living docs — update the spec if the design
changes during implementation.
