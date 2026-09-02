# Avatar models (GLB)

The 3D employee avatars are loaded at runtime from three GLB files that must live
in this folder and be served by Caddy alongside the rest of `public/`:

```
public/assets/models/sit.glb     # seated pose (used when an employee is at a desk)
public/assets/models/stand.glb   # standing pose (roaming "pause")
public/assets/models/walk.glb    # walking pose (roaming movement, animated)
```

These are custom Meshy-AI generated meshes from the original Claude Design project.
They exceed the design-export API's 256 KiB per-file limit, so they are **not**
committed here automatically — copy them in from the design project's
`assets/models/` before (or right after) deploying.

The app degrades gracefully if they are missing: the office, furniture, zones,
seating, search and save all work; seated employees simply render as a floating
marker + name tag instead of a 3D figure, and no console error is thrown
(`modelsReady` swallows the failed fetch).

After copying the files in, on the server re-run:

```bash
sudo cp -r /opt/alliancesim/public/* /var/www/alliancesim/
```
