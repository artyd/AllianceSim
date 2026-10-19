#!/usr/bin/env node
// PostToolUse hook: after an Edit/Write of the frontend, check it:
//   public/js/**/*.js, public/sw.js → `node --check` + every relative import resolves to a file
//   public/index.html               → every css/… and js/… it links exists
// Exit 2 on an error so the harness shows the message and you fix it immediately.
//
// Also runnable by hand (checks everything):  node .claude/scripts/check-html.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PUB = 'public';

// The hook feeds a JSON payload on stdin ({ tool_input: { file_path } }). When run
// by hand there is no stdin, so fall through and check everything.
let changed = '';
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.trim()) changed = JSON.parse(raw)?.tool_input?.file_path ?? '';
} catch { /* no stdin / not JSON — check anyway */ }
const ch = changed.replaceAll('\\', '/');
const isFront = (f) => /\/public\/(js\/.*\.js|sw\.js|index\.html|css\/.*\.css)$/.test('/' + f.replace(/^.*?(?=public\/)/, ''));
if (changed && !isFront(ch)) process.exit(0);

const errors = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const jsFiles = [...walk(path.join(PUB, 'js')).filter((f) => f.endsWith('.js')), path.join(PUB, 'sw.js')].map((f) => f.replaceAll('\\', '/'));

function checkJs(file) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (e) { errors.push(`SYNTAX ERROR in ${file}:\n` + ((e.stderr && e.stderr.toString()) || e.message)); return; }
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = path.join(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) errors.push(`${file}: import '${m[1]}' → missing ${target.replaceAll('\\', '/')}`);
  }
}
function checkHtml() {
  const file = path.join(PUB, 'index.html'), html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)) if (!fs.existsSync(path.join(PUB, m[1]))) errors.push(`${file}: links missing ${m[1]}`);
}

const touched = changed ? jsFiles.filter((f) => ch.endsWith(f)) : jsFiles;
touched.forEach(checkJs);
if (!changed || ch.endsWith('index.html') || ch.endsWith('.css')) checkHtml();

if (errors.length) { console.error('check-html:\n' + errors.join('\n')); process.exit(2); }
console.log(`check-html: OK (${changed ? path.basename(ch) : jsFiles.length + ' js files + index.html'})`);
