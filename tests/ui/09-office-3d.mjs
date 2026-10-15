// Spec 005 (UI): the 3D office renders the live overlay too — 📅 badge sprite over a person in a
// meeting, room label busy — with no console errors.
import { URLS, launch, close, openAs, js, shot, sleep, ok, report } from '../br.mjs';

await launch();
try {
  const a = await openAs('a');
  await js(a, async () => {
    const h = { 'content-type': 'application/json', 'X-Telegram-Init-Data': Telegram.WebApp.initData };
    await fetch('/api/me/events', { method: 'POST', headers: h, body: JSON.stringify({ title: 'Синк', startsAt: new Date(Date.now() - 60e3).toISOString(), endsAt: new Date(Date.now() + 30 * 60e3).toISOString(), room: 'r6', place: 'Переговорна «Львів»' }) });
  });
  const w = await openAs('web');
  await w.evaluateOnNewDocument(() => { try { localStorage.setItem('alliancesim.settings', JSON.stringify({ view: '3d' })); } catch (e) {} });
  await w.setViewport({ width: 1280, height: 820 });
  await w.goto(URLS.web + '?mode=viewer', { waitUntil: 'domcontentloaded', timeout: 90000 }); await sleep(6000);
  // switch to 3D through the settings control (whatever the stored settings format is)
  await js(w, () => { const b = document.querySelector('[data-set="view"] [data-v="3d"]'); if (b) b.click(); });
  await sleep(4000);
  ok(await js(w, () => getComputedStyle(document.getElementById('c')).display !== 'none'), '3D canvas visible');
  ok(await js(w, () => [...document.querySelectorAll('.rl')].some((x) => x.classList.contains('busy') && x.innerText.includes('Львів'))), 'busy room label in 3D');
  // Headless 3D renders in software at a few fps (walking is dt-capped per frame), so check the
  // person heads to «Львів» (r6 centre ≈ 6.75, 64.1) rather than waiting for arrival (2D test does).
  const dist = (p) => Math.hypot(p.x - 6.75, p.z - 64.1);
  const p0 = await js(w, () => window.__where('a')); await sleep(15000);
  const p1 = await js(w, () => window.__where('a'));
  ok(p0 && p1 && (p1.room === 'r6' || dist(p1) < dist(p0) - 1), `heads to the meeting room in 3D: ${p0 && dist(p0).toFixed(1)} → ${p1 && dist(p1).toFixed(1)} m`);
  await shot(w, 'f9-office-3d');
  ok(w.errors.length === 0 && a.errors.length === 0, 'no console errors: ' + [...w.errors, ...a.errors].join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
