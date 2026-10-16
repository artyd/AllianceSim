// Layout audit of every AllianceOS screen in the Mini App (spec 006): finds icons/objects that are
// shifted off-centre, spill out of the screen, overlap their neighbours, get clipped without an
// ellipsis, hide under the tab bar / FAB, collide with the Dynamic Island, or are too small to tap.
// Runs on every phone size, light and dark.   cd tests && npx playwright test audit
import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', '.tmp', 'pw-audit');
fs.mkdirSync(SHOTS, { recursive: true });
const urls = () => JSON.parse(fs.readFileSync(path.join(HERE, '..', '.tmp', 'urls.json'), 'utf8'));
const test = base.extend({ tgPlatform: [null, { option: true }] });

// In-page checker. Returns a list of {type, el, detail} for the given screen root.
function audit(scrId) {
  const root = scrId === 'wheel' ? document.querySelector('.pwov .pwsheet') : scrId === 'home' ? document.querySelector('[data-scr=home]') : scrId === 'cc' ? document.querySelector('.pcc') : document.querySelector(`[data-scr="${scrId}"]`);
  const issues = [];
  const R = root.getBoundingClientRect();
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  const visDeep = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; } return vis(el); };
  const name = (el) => { const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''; const d = Object.keys(el.dataset || {}).slice(0, 2).map((k) => `[data-${k}]`).join(''); const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26); return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${d}${t ? ` “${t}”` : ''}`; };
  const push = (type, el, detail) => issues.push({ type, el: name(el), detail });
  const scrollerX = (el) => { for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX)) return p; } return null; };
  const clipper = (el) => { for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflow !== 'visible' || s.overflowX !== 'visible') return p; } return null; };
  // the part of an element actually on screen: clipped by every overflow ancestor
  const shown = (el) => { let r = el.getBoundingClientRect(); let o = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const st = getComputedStyle(p); if (st.overflow !== 'visible') { const q = p.getBoundingClientRect(); o = { left: Math.max(o.left, q.left), top: Math.max(o.top, q.top), right: Math.min(o.right, q.right), bottom: Math.min(o.bottom, q.bottom) }; } } return o; };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const all = [...root.querySelectorAll('*')].filter((el) => !el.closest('svg') || el.tagName.toLowerCase() === 'svg').filter(visDeep);

  for (const el of all) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el), tag = el.tagName.toLowerCase();
    // 1. spills out of the screen sideways (unless it lives in a horizontal scroller or is clipped by one)
    if ((r.left < R.left - 1 || r.right > R.right + 1) && !scrollerX(el)) {
      const c = clipper(el); const cr = c && c.getBoundingClientRect();
      if (!c || cr.left < R.left - 1 || cr.right > R.right + 1) push('outside-screen', el, `x ${Math.round(r.left - R.left)}…${Math.round(r.right - R.left)} of ${Math.round(R.width)}`);
    }
    // 2. text cut off without an ellipsis / line clamp
    const leafText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (leafText && tag !== 'textarea' && tag !== 'input') {
      if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none' && !/(auto|scroll)/.test(s.overflowX)) push('text-clipped', el, `${el.scrollWidth}>${el.clientWidth}`);
      if (el.scrollHeight > el.clientHeight + 2 && s.overflowY === 'hidden' && s.webkitLineClamp === 'none' && el.clientHeight > 0) push('text-cut-vertically', el, `${el.scrollHeight}>${el.clientHeight}`);
      // text that visibly runs past a clipping ancestor
      const c = clipper(el); if (c && !scrollerX(el)) { const cr = c.getBoundingClientRect(); if (r.right > cr.right + 2 && s.textOverflow !== 'ellipsis' && getComputedStyle(c).textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none') push('text-runs-out', el, `right +${Math.round(r.right - cr.right)}px past ${name(c)}`); }
    }
    // 3. an icon alone in a badge/button/tile must sit in its centre
    const kids = [...el.children].filter(vis);
    if (kids.length === 1 && kids[0].tagName.toLowerCase() === 'svg' && !(el.innerText || '').trim() && (tag === 'button' || tag === 'a' || /grid|flex/.test(s.display)) && r.width <= 90 && r.height <= 90) {
      const k = kids[0].getBoundingClientRect();
      const dx = (k.left + k.right) / 2 - (r.left + r.right) / 2, dy = (k.top + k.bottom) / 2 - (r.top + r.bottom) / 2;
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) push('icon-off-center', el, `dx ${dx.toFixed(1)} dy ${dy.toFixed(1)}`);
    }
    // 4. in-flow siblings of a flex/grid container must not overlap
    if (/flex|grid/.test(s.display) && kids.length > 1) {
      const flow = kids.filter((k) => !/absolute|fixed/.test(getComputedStyle(k).position) && getComputedStyle(k).marginLeft[0] !== '-' && getComputedStyle(k).marginTop[0] !== '-');
      for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
        const a = flow[i].getBoundingClientRect(), b = flow[j].getBoundingClientRect();
        if (inter(a, b) > 4) push('overlap', flow[i], `with ${name(flow[j])}`);
      }
    }
    // 5a. accessibility: an icon-only control needs a name for screen readers
    if ((tag === 'button' || (tag === 'a' && el.getAttribute('href'))) && !(el.innerText || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.getAttribute('aria-labelledby') && !el.closest('[aria-hidden=true]')) push('a11y-no-label', el, 'icon-only control without aria-label');
    // 5. tap targets
    if ((tag === 'button' || (tag === 'a' && el.getAttribute('href')) || el.hasAttribute('data-go')) && !el.closest('.pwalls,.paz,.pdrinks,.wkb') && (r.width < 28 || r.height < 26)) push('tap-target-small', el, `${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // 6. nothing important hidden under the floating tab bar / FAB once the list is scrolled to the end
  const bar = document.querySelector('.ptabbar.on'); const fab = root.querySelector('.phead .act');
  for (const sc of root.querySelectorAll('.pscroll')) {
    if (!visDeep(sc)) continue; sc.scrollTop = sc.scrollHeight;
    const last = [...sc.querySelectorAll('.prow,.ptask,.pset,.pfield,.pgrp,.pevb,.pdr,.pcard,.pbtn')].filter(visDeep).pop();
    if (last && bar) { const lr = last.getBoundingClientRect(), br = bar.getBoundingClientRect(); if (inter(lr, br) > 4 && lr.top < br.top) push('hidden-under-tabbar', last, 'still covered when scrolled to the end'); }
    sc.scrollTop = 0;
  }
  if (fab && visDeep(fab) && bar) { if (inter(fab.getBoundingClientRect(), bar.getBoundingClientRect()) > 1) push('overlap', fab, 'FAB on the tab bar'); }
  // 7. the Dynamic Island must not cover the header (back button, title, actions)
  const isl = document.querySelector('.pnotch');
  if (isl && visDeep(isl)) { const ir = isl.getBoundingClientRect();
    for (const h of all) { if (h.closest('.pnotch') || h === root) continue; const t = h.tagName.toLowerCase(); const leaf = [...h.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if ((leaf || t === 'button' || t === 'input' || t === 'svg') && inter(ir, shown(h)) > 2) push('island-covers', h, 'under the Dynamic Island'); } }
  // 8. toasts are compact banners fully on screen
  const toast = document.getElementById('toast');
  if (toast && visDeep(toast)) { const tr = toast.getBoundingClientRect(); if (tr.height > 80 || tr.top < 0 || tr.bottom > innerHeight || tr.left < 0 || tr.right > innerWidth) push('toast-broken', toast, `${Math.round(tr.width)}×${Math.round(tr.height)} at ${Math.round(tr.left)},${Math.round(tr.top)}`); }
  // de-duplicate
  const seen = new Set(); return issues.filter((i) => { const k = i.type + i.el + i.detail; if (seen.has(k)) return false; seen.add(k); return true; });
}

for (const theme of ['light', 'dark']) {
  test(`audit every screen (${theme})`, async ({ page, tgPlatform }, info) => {
    test.skip(!tgPlatform, 'Mini App phone projects only');
    test.setTimeout(240_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((theme) => { try { localStorage.setItem('alliancesim.tour.v1', '1'); localStorage.setItem('alliancesim.myday', JSON.stringify(new Date().toDateString())); localStorage.setItem('alliancesim.phone.theme', JSON.stringify(theme)); } catch (e) {} }, theme);
    await page.goto(urls().a.replace('tgWebAppPlatform=tdesktop', 'tgWebAppPlatform=' + tgPlatform));
    await page.waitForSelector('#wMood [data-mood-set]');
    await page.waitForTimeout(400);

    const top = () => page.evaluate(() => { const s = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0]; return s ? s.dataset.scr : 'home'; });
    const tap = async (sel) => { const ok = await page.evaluate((sel) => { const s = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0] || document.querySelector('[data-scr=home]'); const el = s.querySelector(sel) || document.querySelector(sel); if (!el) return false; el.click(); return true; }, sel); await page.waitForTimeout(550); return ok; };
    const type = (sel, v) => page.evaluate(([sel, v]) => { const s = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0]; const el = s.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
    const home = async () => { await page.evaluate(() => { while (document.querySelector('#pbody .pscreen.show')) { document.getElementById('pbar').click(); break; } }); await page.waitForTimeout(500); };
    const report = {};
    const check = async (label, scr) => {
      await page.waitForTimeout(450);
      const id = scr || await top();
      const found = await page.evaluate(audit, id);
      if (found.length) report[label] = found;
      await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${theme}-${label}.png`) });
    };

    // seed realistic, long-ish content
    await tap('.pdock [data-go=tasks]');
    await type('[data-in]', 'Підготувати квартальний звіт для керівництва з усіма додатками та графіками'); await tap('[data-add]');
    await type('[data-in]', 'Купити воду'); await tap('[data-add]');
    await check('tasks');
    await tap('.ptask .t'); await check('taskform'); await home();
    await tap('.pdock [data-go=calendar]');
    await tap('[data-new]'); await check('evform');
    await type('[data-title]', 'Стратегічна сесія з планування роботи відділу на наступний квартал');
    await page.evaluate(() => { const s = document.querySelector('[data-scr=evform]'); s.querySelector('[data-st]').value = '10:00'; s.querySelector('[data-en]').value = '10:30'; });
    await tap('button[type=submit]'); await page.waitForTimeout(500);
    await check('calendar');
    await tap('[data-ev]'); await check('event'); await home();
    await tap('.pdock [data-go=chatlist]'); await check('chatlist');
    await tap('[data-new]'); await check('chatnew');
    await tap('[data-id=b]'); await page.waitForTimeout(900);
    await type('[data-in]', 'Привіт! Скинь, будь ласка, оновлений макет телефона до обіду — хочу показати команді.'); await tap('[data-send]'); await page.waitForTimeout(600);
    await check('conv'); await home();
    await tap('.pdock [data-go=chatlist]'); await check('chatlist-filled');
    await page.evaluate(() => document.querySelector('.ptabbar [data-tab-go=calls]').click()); await check('calls');
    await page.evaluate(() => document.querySelector('.ptabbar [data-tab-go=contacts]').click()); await check('contacts');
    await tap('[data-id]'); await check('contact'); await home();
    for (const app of ['desk', 'broadcast', 'coffee', 'profile', 'settings']) { await tap(`.pgrid [data-go=${app}]`); await page.waitForTimeout(500); await check(app); if (app === 'settings') { await tap('[data-goto=wall]'); await check('wall'); } await home(); }
    await tap('.pgrid [data-go=profile]'); await tap('[data-edit]'); await check('meedit');
    await tap('[data-bd]'); await page.waitForTimeout(500); await check('wheel-birthday', 'wheel');
    await page.evaluate(() => document.querySelector('.pwov [data-x]').click()); await page.waitForTimeout(400);
    await tap('[data-dept]'); await page.waitForTimeout(500); await check('wheel-dept', 'wheel');
    await page.evaluate(() => document.querySelector('.pwov [data-x]').click()); await page.waitForTimeout(400); await home(); await home();
    // spec 007: games
    const cc = async (target) => { await home(); await page.evaluate(() => { const h = document.querySelector('[data-scr=home]'); h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 20, bubbles: true })); h.dispatchEvent(new PointerEvent('pointerup', { clientY: 240, bubbles: true })); }); await page.waitForTimeout(500); await page.evaluate((t) => document.querySelector('.pcc [data-ccgo=' + t + ']').click(), target); await page.waitForTimeout(1500); };
    await home(); await tap('.pgrid [data-go=games]'); await check('games');
    await tap('[data-k=ttt]'); await check('gsetup');
    await tap('[data-mode] [data-v=bot]'); await tap('[data-go-play]'); await tap('.tc[data-i="4"]'); await page.waitForTimeout(800); await check('game-ttt');
    for (const k of ['chess', 'checkers', 'sea']) { await home(); await tap('.pgrid [data-go=games]'); await tap('[data-k=' + k + ']'); await tap('[data-mode] [data-v=bot]'); await tap('[data-go-play]'); await check('game-' + k); }
    for (const k of ['2048', 'snake', 'word']) { await home(); await tap('.pgrid [data-go=games]'); await tap('[data-k="' + k + '"]'); await check('game-' + k); }
    await home(); await tap('.pgrid [data-go=games]'); await tap('[data-top]'); await page.waitForTimeout(600); await check('leaderboard');
    // spec 007: search / my day / rooms
    await home(); await tap('.psrchpill'); await type('[data-q]', 'а'); await page.evaluate(() => document.querySelector('[data-scr=search] [data-q]').dispatchEvent(new Event('input'))); await check('search');
    await cc('myday'); await check('myday');
    await cc('rooms'); await check('rooms');
    await home();
    await check('home', 'home');
    await page.evaluate(() => { const h = document.querySelector('[data-scr=home]'); h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 20, bubbles: true })); h.dispatchEvent(new PointerEvent('pointerup', { clientY: 240, bubbles: true })); });
    await page.waitForTimeout(600); await check('control-center', 'cc');

    fs.writeFileSync(path.join(SHOTS, `${info.project.name}-${theme}-report.json`), JSON.stringify(report, null, 1));
    const flat = Object.entries(report).flatMap(([s, l]) => l.map((i) => `${s}: ${i.type} — ${i.el} (${i.detail})`));
    expect(errors, 'no page errors').toEqual([]);
    expect(flat, 'layout issues').toEqual([]);
  });
}
