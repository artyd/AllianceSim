// Spec 008: bot side of HR analytics — report periods, HR recipients, Mini App «Excel + PDF у чат»
// (hr_export → summary + 2 documents), /analytics for HR only. Real bot vs a fake Bot API.
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'url';
import { start, stop, call, seed, ok, eq, report, BASE, BOT, HR, REPO } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [], updates = []; let uid = 1, mid = 500;
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks), method = req.url.split('/').pop();
    let p = {}; try { p = JSON.parse(raw.toString() || '{}'); } catch (e) { p = { multipart: raw.toString('latin1') }; }
    const send = (result) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
    if (method === 'getUpdates') {
      for (let i = 0; i < 10 && !updates.length; i++) await sleep(100);
      const off = p.offset || 0, out = updates.filter((u) => u.update_id >= off); updates.length = 0;
      return send(out);
    }
    calls.push({ method, p, size: raw.length });
    if (method === 'getMe') return send({ id: 999, is_bot: true, first_name: 'Bot', username: 'test_bot' });
    if (method === 'sendMessage' || method === 'sendDocument') return send({ message_id: mid++, date: 0, chat: { id: p.chat_id || 0, type: 'private' }, text: p.text });
    return send(true);
  });
});
await new Promise((r) => srv.listen(18101, r));

// ── report periods (pure) ──
const per = await import(pathToFileURL(path.join(REPO, 'bot', 'src', 'periods.js')).href);
eq(per.lastWeek('2026-10-19'), { from: '2026-10-12', to: '2026-10-18' }, 'Monday → previous Mon–Sun');
eq(per.lastWeek('2026-10-25'), { from: '2026-10-12', to: '2026-10-18' }, 'Sunday → the week before');
eq(per.lastMonth('2026-11-01'), { from: '2026-10-01', to: '2026-10-31' }, 'previous month');
eq(per.lastMonth('2026-03-01'), { from: '2026-02-01', to: '2026-02-28' }, 'February');
eq(per.lastMonth('2026-01-01'), { from: '2025-12-01', to: '2025-12-31' }, 'year boundary');

await start({ HR_NAMES: 'Коваль Анна' });
const bot = spawn(process.execPath, [path.join(REPO, 'bot', 'src', 'index.js')], {
  env: { ...process.env, TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_API_ROOT: 'http://127.0.0.1:18101', API_URL: BASE, EDIT_TOKEN: HR, WEBAPP_URL: 'https://office.test/' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
bot.stderr.on('data', (d) => process.stdout.write('[bot!] ' + d));
const waitFor = async (pred, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = calls.find(pred); if (c) return c; await sleep(200); } return null; };
const docs = (chat) => calls.filter((c) => c.method === 'sendDocument' && new RegExp(`name="chat_id"\\r\\n\\r\\n${chat}\\r\\n`).test(c.p.multipart || ''));
const cmd = (tg, text) => updates.push({ update_id: uid++, message: { message_id: uid, date: Math.floor(Date.now() / 1000), from: { id: tg, is_bot: false, first_name: 'U' }, chat: { id: tg, type: 'private' }, text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } });

try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001, extra: { status: 'office', mood: 'good' } },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002, extra: { status: 'remote', mood: 'ok' } },
  ]);
  ok(await waitFor((c) => c.method === 'getMe'), 'bot started');
  eq((await call('GET', '/analytics/hr-recipients', { hr: true })).data.map((r) => r.telegram_id), ['1001'], 'HR recipients = HR_NAMES');

  // Mini App → «Excel + PDF у чат»
  const r = await call('POST', '/me/hr/export', { as: 1001, body: { days: 7 } });
  eq(r.status, 200, 'export queued from the Mini App');
  const msg = await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1001 && /📊/.test(c.p.text || ''));
  ok(msg && /Середній настрій/.test(msg.p.text) && /check-in/.test(msg.p.text), 'summary message');
  ok(msg && (msg.p.reply_markup?.inline_keyboard || []).flat().some((b) => b.web_app && /open=analytics/.test(b.web_app.url)), '«Відкрити аналітику» button deep-links the app');
  for (let i = 0; i < 60 && docs(1001).length < 2; i++) await sleep(250);
  const d = docs(1001);
  eq(d.length, 2, 'two documents sent');
  ok(d.some((c) => /filename="?analytics_[\d-]+_[\d-]+\.xlsx/.test(c.p.multipart) && c.size > 4000), 'xlsx attached');
  ok(d.some((c) => /filename="?analytics_[\d-]+_[\d-]+\.pdf/.test(c.p.multipart) && c.p.multipart.includes('%PDF-')), 'pdf attached');
  await sleep(9000); // one more drain tick: the export must not be sent twice
  eq(docs(1001).length, 2, 'export delivered once');

  // /analytics
  cmd(1002, '/analytics');
  ok(await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1002 && /лише HR/.test(c.p.text || '')), '/analytics refused for non-HR');
  const before = docs(1001).length;
  cmd(1001, '/analytics');
  ok(await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1001 && /Звіт HR за 7 днів/.test(c.p.text || '')), '/analytics → summary for HR');
  for (let i = 0; i < 60 && docs(1001).length < before + 2; i++) await sleep(250);
  eq(docs(1001).length, before + 2, '/analytics → Excel + PDF');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
bot.kill(); srv.close();
const f = report();
await stop();
process.exit(f ? 1 : 0);
