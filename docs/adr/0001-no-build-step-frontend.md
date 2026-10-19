# No build step for the frontend

The site is static files served by Caddy: plain HTML, CSS and native ES modules, with Three.js from a CDN import map. No bundler, no framework, no transpiler. A frontend deploy is a file copy and anyone can read the shipped code as-is.

## Consequences

- New frontend code is an ES module under `public/js/` imported by URL; styles are plain `.css` files under `public/css/`.
- Every module file must stay valid for the browser directly; the PostToolUse hook syntax-checks frontend files on save.
- New `public/` files must be added to the service worker shell list (`public/sw.js`) or they are missing offline.
