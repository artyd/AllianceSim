// Spec 008 (UI): HR analytics v2 — web tab (filters, sub-tabs, timesheet, person card, export,
// fullscreen, dark) and the HR-only «Аналітика» app in the Mini App (Анна = HR_NAMES in devstack).
import { URLS, launch, close, openAs, js, shot, sleep, ok, report } from '../br.mjs';

process.env.STACK = 'dev';
const { seedHistory } = await import('../fixtures/analytics-history.mjs');
await launch();
const pages = [];
try {
  await seedHistory();
  const txt = (p) => js(p, () => document.getElementById('stats').innerText);

  // web without the HR code → asked for it
  const w0 = await openAs('web'); pages.push(w0);
  await w0.setViewport({ width: 1280, height: 860 });
  await js(w0, () => document.querySelector('#tabs [data-tab="stats"]').click()); await sleep(600);
  ok(/код/.test(await txt(w0)), 'no code → asks for the HR code');

  // HR (code stored as after login)
  const w = await openAs('web'); pages.push(w);
  await w.evaluateOnNewDocument(() => { try { localStorage.setItem('alliancesim.edit_token', 'hr-token'); localStorage.removeItem('alliancesim.analytics.v2'); } catch (e) {} });
  await w.setViewport({ width: 1366, height: 900 });
  await w.goto(URLS.web, { waitUntil: 'networkidle2' }); await sleep(1500);
  await js(w, () => document.querySelector('#tabs [data-tab="stats"]').click()); await sleep(1800);
  let t = await txt(w);
  ok(/працівників/.test(t) && /середній настрій/.test(t) && /check-in/.test(t), 'overview tiles');
  ok(/Потребують уваги/.test(t) && /Віра Мак/.test(t) && /Богдан Лис/.test(t), 'attention list (low mood, quiet)');
  ok(await js(w, () => !!document.querySelector('.an-tabs [data-tab="overview"] b')), 'attention badge on the tab');
  ok(await js(w, () => { const s = document.querySelector('.an-chart[data-kind="line"] svg'); return !!s && Math.abs(s.getBoundingClientRect().width - s.parentElement.clientWidth) < 3; }), 'mood chart painted at the card width');
  // hover → tooltip
  await js(w, () => { const h = document.querySelector('.an-hit'), r = h.getBoundingClientRect(); h.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.5, clientY: r.top + 30, bubbles: true })); });
  ok(await js(w, () => { const tp = document.querySelector('.an-tip'); return tp.style.display === 'block' && /\d/.test(tp.textContent); }), 'hover tooltip');

  // department filter + period
  await js(w, () => { const s = document.querySelector('[data-dept]'); s.value = 'Sales'; s.dispatchEvent(new Event('change')); }); await sleep(1200);
  t = await txt(w);
  ok(/Sales/.test(t) && !/Віра Мак/.test(t), 'department filter');
  await js(w, () => document.querySelector('[data-per="7"]').click()); await sleep(1200);
  ok(/7 дн\./.test(await txt(w)), 'period 7 days');
  await js(w, () => { const s = document.querySelector('[data-dept]'); s.value = 'all'; s.dispatchEvent(new Event('change')); }); await sleep(800);
  await js(w, () => document.querySelector('[data-per="custom"]').click()); await sleep(1200);
  ok(await js(w, () => !!document.querySelector('[data-from]') && !!document.querySelector('[data-to]')), 'custom range inputs');
  await js(w, () => document.querySelector('[data-per="30"]').click()); await sleep(1200);

  // sub-tabs
  for (const [k, re] of [['presence', /Табель/], ['mood', /Пульс тижня/], ['engagement', /ранковий check-in/], ['people', /Новачки/]]) {
    await js(w, (k) => document.querySelector(`.an-tabs [data-tab="${k}"]`).click(), k); await sleep(500);
    ok(re.test(await txt(w)), 'sub-tab ' + k);
  }
  ok(/Тарас Мельник/.test(await txt(w)) && /3\/8/.test(await txt(w)), 'newcomer onboarding progress');
  await js(w, () => document.querySelector('.an-tabs [data-tab="presence"]').click()); await sleep(500);
  ok(await js(w, () => document.querySelectorAll('.an-sheet tbody tr').length >= 10 && document.querySelectorAll('.an-sheet tbody tr:first-child td.c').length === 30), 'timesheet people × 30 days');
  ok(await js(w, () => document.querySelectorAll('.an-chart[data-kind="stack"] .an-bar').length === 30), 'stacked daily statuses');

  // fullscreen + person card
  await js(w, () => document.querySelector('[data-full]').click()); await sleep(500);
  ok(await js(w, () => document.getElementById('app').dataset.anfull === '1' && document.getElementById('dock').getBoundingClientRect().height > 800), 'fullscreen');
  await js(w, () => [...document.querySelectorAll('.an-sheet [data-person]')].find((x) => /Віра/.test(x.textContent)).click()); await sleep(1500);
  t = await js(w, () => document.querySelector('.an-pc')?.innerText || '');
  ok(/Віра Мак/.test(t) && /низький настрій/.test(t) && /Настрій по днях/.test(t), 'person card: signals + personal mood');
  ok(/пульс тижня тут не показуються/.test(t), 'person card: no pulse');
  await shot(w, 'e8-person');
  await js(w, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))); await sleep(300);
  ok(await js(w, () => !document.querySelector('.an-ov')), 'Esc closes the card');
  await js(w, () => document.querySelector('[data-full]').click()); await sleep(300);
  ok(await js(w, () => !document.getElementById('app').dataset.anfull), 'leave fullscreen');

  // export → download (blob link)
  await js(w, () => { window.__dl = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); else o.call(this); }; });
  await js(w, () => document.querySelector('[data-exp="xlsx"]').click()); await sleep(2500);
  await js(w, () => document.querySelector('[data-exp="pdf"]').click()); await sleep(3000);
  const dl = await js(w, () => window.__dl);
  ok(dl.some((n) => /^analytics_.*\.xlsx$/.test(n)) && dl.some((n) => /^analytics_.*\.pdf$/.test(n)), 'Excel + PDF downloaded: ' + dl.join(', '));

  // dark theme
  await js(w, () => { document.getElementById('app').dataset.ui = 'dark'; document.querySelector('.an-tabs [data-tab="overview"]').click(); }); await sleep(500);
  ok(await js(w, () => getComputedStyle(document.querySelector('.an-tile')).backgroundColor !== 'rgb(245, 239, 232)'), 'dark tiles');
  await shot(w, 'e8-analytics-dark');

  // ── Mini App: HR sees the app, a colleague doesn't ──
  const a = await openAs('a'); pages.push(a); await sleep(1500);
  ok(await js(a, () => !!document.querySelector('#pbody [data-go="hranalytics"]')), 'HR: «Аналітика» icon on the home screen');
  await js(a, () => document.querySelector('#pbody [data-go="hranalytics"]').click()); await sleep(2500);
  t = await js(a, () => document.querySelector('[data-scr="hranalytics"]').innerText);
  ok(/Потребують уваги/.test(t) && /Excel \+ PDF у чат/.test(t), 'Mini App analytics + send-to-chat');
  ok(await js(a, () => { const s = document.querySelector('[data-scr="hranalytics"] .pscroll'); return s.scrollWidth <= s.clientWidth + 1; }), 'no horizontal overflow on the phone');
  await js(a, () => document.querySelector('[data-exp="both"]').click()); await sleep(1500);
  ok(/надіслано в чат/.test(await js(a, () => document.getElementById('toast')?.textContent || '')), 'send-to-chat confirmation');
  await shot(a, 'e8-miniapp');
  const b = await openAs('b'); pages.push(b); await sleep(1500);
  ok(await js(b, () => !document.querySelector('#pbody [data-go="hranalytics"]')), 'non-HR: no analytics app');

  ok(pages.every((p) => p.errors.length === 0), 'no console errors: ' + pages.flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
