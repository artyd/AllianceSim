# Avatar models (GLB)

The 3D employee avatars load at runtime from these three GLB files (served by Caddy
alongside the rest of `public/`):

```
sit.glb     # seated pose   — Meshy "Sitting Answering Questions" (224632 bytes)
stand.glb   # standing pose — Meshy "Stand and Chat"              (175228 bytes)
walk.glb    # walking pose  — Meshy "Walking" (animated)          (125072 bytes)
```

They are the exact meshes from the original Claude Design project and are committed
here. They are tracked as binary (see `.gitattributes`) so line-ending conversion
never corrupts them.

The app degrades gracefully if any are missing: office, furniture, zones, seating,
search and save all still work; a seated employee just renders as a floating marker
+ name tag instead of a 3D figure, and no console error is thrown.
