// Test runner:  node run.mjs [api|ui] [name-filter]
//  api — each file in api/ starts its own throwaway stack (DB + API; bot.mjs adds the bot)
//  ui  — starts devstack (STACK=dev) once, runs each ui/ scenario in headless Chrome
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [which = 'all', filter = ''] = process.argv.slice(2);
const files = (dir) => fs.readdirSync(path.join(HERE, dir)).filter((f) => f.endsWith('.mjs') && f.includes(filter)).sort().map((f) => path.join(dir, f));

function run(file, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, file)], { cwd: HERE, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const sum = (out.match(/\d+ passed, \d+ failed/g) || []).pop() || 'no summary';
      const fails = out.split('\n').filter((l) => /✗|Error|api!|bot!/.test(l)).slice(0, 25);
      console.log(`${code === 0 ? '✓' : '✗'} ${file.padEnd(16)} ${sum}`);
      for (const l of fails) console.log('    ' + l.trim());
      resolve(code === 0);
    });
  });
}

let okAll = true;
if (which === 'all' || which === 'api') {
  for (const f of files('api')) okAll = (await run(f)) && okAll;
}
if (which === 'all' || which === 'ui') {
  const dev = spawn(process.execPath, [path.join(HERE, 'devstack.mjs')], { cwd: HERE, env: { ...process.env, STACK: 'dev' } });
  let log = '';
  dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 300 && !/devstack ready/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
  if (!/devstack ready/.test(log)) { console.log('devstack failed to start:\n' + log.slice(-2000)); okAll = false; }
  else for (const f of files('ui')) okAll = (await run(f)) && okAll;
  await fetch('http://localhost:' + (process.env.WEB_PORT || 5055) + '/__shutdown').catch(() => {});
  for (let i = 0; i < 40 && dev.exitCode === null; i++) await new Promise((r) => setTimeout(r, 250));
  dev.kill();
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(okAll ? '\nALL GREEN' : '\nFAILURES');
process.exit(okAll ? 0 : 1);
