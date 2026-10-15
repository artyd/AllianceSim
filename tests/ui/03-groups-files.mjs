// Phase 3 browser check: office/dept chats, group create/manage, attachments (image + file).
import fs from 'fs';
import { launch, close, openAs, tap, type, key, text, js, home, shot, sleep, ok, report, SHOTS } from '../br.mjs';

// a real ~600KB PNG (noise) to exercise client-side compression, plus a text file
import zlib from 'zlib';
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 13 + ((x * y) % 251)) & 255; }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = SHOTS + 'photo.png', TXT = SHOTS + 'звіт.txt';
fs.writeFileSync(IMG, png(1200, 800)); fs.writeFileSync(TXT, 'Звіт за квартал\n');

await launch();
try {
  const a = await openAs('a'), b = await openAs('b');
  await tap(a, '[data-go=chatlist]'); await sleep(600);
  const la = await text(a);
  ok(la.includes('Весь офіс') && la.includes('HR'), 'A sees office + HR chats');
  // office chat message → B live, with sender name
  await js(a, () => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes('Весь офіс')).click()); await sleep(900);
  await type(a, '[data-in]', 'Всім доброго ранку!'); await key(a, '[data-in]', 'Enter'); await sleep(900);
  await tap(b, '[data-go=chatlist]'); await sleep(600);
  ok((await text(b)).includes('Анна: Всім доброго ранку!'), 'B list preview with sender');
  await js(b, () => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes('Весь офіс')).click()); await sleep(900);
  ok((await text(b)).includes('Анна Коваль') && (await text(b)).includes('Всім доброго ранку!'), 'B conv shows sender name in group');
  ok((await text(b, '[data-sub]')).includes('учасників'), 'group header shows member count');
  await home(b);

  // A creates a group with B
  await home(a); await tap(a, '[data-go=chatlist]'); await sleep(400);
  await tap(a, '[data-new]'); await tap(a, '[data-g]');
  await type(a, '[data-title]', 'Корпоратив');
  await tap(a, '[data-add]'); await sleep(300);
  await tap(a, '[data-id=b]'); await tap(a, '[data-ok]'); await sleep(400);
  ok((await text(a)).includes('Богдан Лис'), 'member added to draft');
  await tap(a, '[data-create]'); await sleep(1200);
  ok((await text(a, '[data-title]')) === 'Корпоратив', 'group conv opened');
  await tap(b, '[data-go=chatlist]'); await sleep(800);
  ok((await text(b)).includes('Корпоратив'), 'B sees new group live');

  // attachments: image (compressed) + text file
  const fileInput = async (p, file) => { const h = await p.$('[data-scr=conv] .att input[type=file]'); await h.uploadFile(file); };
  await fileInput(a, IMG); await sleep(2500);
  const imgOk = await js(a, () => { const i = document.querySelector('[data-scr=conv] img.pimg'); return i && i.complete && i.naturalWidth; });
  ok(imgOk && imgOk <= 1600, 'A sees uploaded image (w=' + imgOk + ')');
  const meta = await js(a, async () => { const r = await fetch(document.querySelector('[data-scr=conv] img.pimg').src); return { t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; });
  ok(meta.t === 'image/jpeg' && meta.n < 600000, 'image was compressed to jpeg (' + meta.n + ' bytes)');
  await fileInput(a, TXT); await sleep(1500);
  ok((await text(a)).includes('звіт.txt'), 'file card shown');
  await js(b, () => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes('Корпоратив')).click()); await sleep(1500);
  ok(await js(b, () => { const i = document.querySelector('[data-scr=conv] img.pimg'); return !!(i && i.naturalWidth); }), 'B sees image');
  ok((await text(b)).includes('звіт.txt'), 'B sees file');
  await shot(b, 'p3-b-group');

  // chat info: B mutes; A renames, then removes B
  await tap(b, '[data-info]'); await sleep(400);
  ok((await text(b)).includes('Учасники · 2'.toUpperCase()) || (await text(b)).toLowerCase().includes('учасники · 2'), 'info members count');
  ok(!(await js(b, () => !!document.querySelector('[data-scr=chatinfo] [data-rename]'))), 'non-admin cannot rename');
  await tap(b, '[data-mute]'); await sleep(600);
  ok(await js(b, () => document.querySelector('[data-scr=chatinfo] [data-mute]').getAttribute('aria-pressed') === 'true'), 'B muted');
  await tap(a, '[data-info]'); await sleep(400);
  await type(a, '[data-title]', 'Корпоратив 🎉'); await tap(a, '[data-rename]'); await sleep(800);
  ok((await text(b)).includes('Корпоратив 🎉'), 'rename reaches B live');
  await shot(a, 'p3-a-info');
  await tap(a, '[data-rm=b]'); await tap(a, '[data-rm=b]'); await sleep(1200);
  ok(!(await js(b, () => document.querySelector('#pbody .pscreen.show[data-scr=conv]'))), 'B kicked out of conv');
  ok(!(await text(b)).includes('Корпоратив'), 'group gone from B list');
  // leave
  await tap(a, '[data-leave]'); await tap(a, '[data-leave]'); await sleep(900);
  ok(!(await text(a)).includes('Корпоратив'), 'A left, group gone');
  ok(a.errors.length === 0 && b.errors.length === 0, 'no console errors: ' + [...a.errors, ...b.errors].join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
