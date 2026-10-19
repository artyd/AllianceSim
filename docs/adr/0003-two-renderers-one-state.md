# Two renderers over one state

The office plan is drawn by a Canvas-2D top-down renderer (default, runs on weak office PCs) and an optional Three.js 3D scene. Both read the same `state` and the same `EP` roaming map; neither owns data.

## Consequences

- Every new piece of geometry or interaction is handled in both renderers; `sync*` 3D builders no-op in 2D, and anything that changes the 2D picture sets `dirty2d = true`.
- Coordinates go through the rotation/flip-aware transform (`w2s`/`s2w`/`project`) and are scaled by the content scale `CS`.
- Roaming is stepped in code that does not rely on `requestAnimationFrame`, which pauses in hidden tabs.
