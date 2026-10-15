#!/usr/bin/env node
// PostToolUse hook: after an Edit/Write of the frontend, syntax-check it:
//   public/index.html → its <script type="module"> block (the office app)
//   public/phone.js   → the phone module (spec 005 F)
// Exit 2 on a parse error so the harness shows the message and you fix it immediately.
//
// Also runnable by hand:  node .claude/scripts/check-html.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HTML = 'public/index.html', PHONE = 'public/phone.js';

// The hook feeds a JSON payload on stdin ({ tool_input: { file_path } }). When run
// by hand there is no stdin, so fall through and check everything.
let changed = '';
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.trim()) changed = JSON.parse(raw)?.tool_input?.file_path ?? '';
} catch { /* no stdin / not JSON — check anyway */ }
const ch = changed.replaceAll('\\', '/');
if (changed && !ch.endsWith(HTML) && !ch.endsWith(PHONE)) process.exit(0);

function check(label, source) {
  const tmp = path.join(os.tmpdir(), 'alliancesim-check-' + path.basename(label) + '.mjs');
  fs.writeFileSync(tmp, '//\n' + source);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`check-html: ${label} — syntax OK`);
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString()) || e.message;
    console.error(`check-html: SYNTAX ERROR in ${label}:\n` + msg);
    process.exit(2); // exit 2 → the harness feeds stderr back so it gets fixed
  }
}

if (fs.existsSync(HTML) && (!changed || ch.endsWith(HTML))) {
  const m = fs.readFileSync(HTML, 'utf8').match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) console.error(`check-html: no <script type="module"> found in ${HTML}`);
  else check('index.html module script', m[1]);
}
if (fs.existsSync(PHONE) && (!changed || ch.endsWith(PHONE))) check('phone.js', fs.readFileSync(PHONE, 'utf8'));
