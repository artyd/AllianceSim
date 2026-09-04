#!/usr/bin/env node
// Tiny static file server for local testing of the frontend.
//   node .claude/scripts/serve.cjs [root=public] [port=5055]
// The app falls back to localStorage when /api is unreachable, so the UI works
// without the backend. Open http://localhost:<port>/ after starting.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || 'public';
const port = Number(process.argv[3] || 5055);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
};

http
  .createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/index.html';
    const file = path.join(root, url);
    // stay within root
    if (!path.resolve(file).startsWith(path.resolve(root))) {
      res.writeHead(403);
      return res.end('403');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('404');
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
      });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
