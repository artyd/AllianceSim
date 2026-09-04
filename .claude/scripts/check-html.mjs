#!/usr/bin/env node
// PostToolUse hook: after an Edit/Write, if public/index.html changed, syntax-check
// its <script type="module"> block (the whole app lives there). Exit non-zero on a
// parse error so the harness shows the message and you fix it immediately.
//
// Also runnable by hand:  node .claude/scripts/check-html.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TARGET = 'public/index.html';

// The hook feeds a JSON payload on stdin ({ tool_input: { file_path } }). When run
// by hand there is no stdin, so fall through and check anyway.
let changed = '';
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.trim()) changed = JSON.parse(raw)?.tool_input?.file_path ?? '';
} catch { /* no stdin / not JSON — check anyway */ }

if (changed && !changed.replaceAll('\\', '/').endsWith(TARGET)) process.exit(0);

if (!fs.existsSync(TARGET)) process.exit(0);
const html = fs.readFileSync(TARGET, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) {
  console.error(`check-html: no <script type="module"> found in ${TARGET}`);
  process.exit(0);
}

const tmp = path.join(os.tmpdir(), 'alliancesim-check.mjs');
fs.writeFileSync(tmp, '//\n' + m[1]);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  console.log('check-html: index.html module script — syntax OK');
} catch (e) {
  const msg = (e.stderr && e.stderr.toString()) || e.message;
  console.error('check-html: SYNTAX ERROR in public/index.html module script:\n' + msg);
  process.exit(2); // exit 2 → the harness feeds stderr back so it gets fixed
}
