// AllianceOS 2.0 (spec 006) on real screen sizes: fullscreen request, Dynamic Island, dense home
// that fits without scrolling, nothing spills out of the screen, tab bar + FAB, office web frame.
import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', '.tmp', 'pw-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const urls = () => JSON.parse(fs.readFileSync(path.join(HERE, '..', '.tmp', 'urls.json'), 'utf8'));

const test = base.extend({
  tgPlatform: [null, { option: true }],
  // Console errors fail the test; Telegram postEvents are recorded for the fullscreen check.
  page: async ({ page }, use) => {
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
    await page.addInitScript(() => {
      // Mobile Telegram clients receive Mini App events through this proxy — record them.
      window.__tgEvents = [];
      window.TelegramWebviewProxy = { postEvent: (type) => window.__tgEvents.push(type) };
      try { localStorage.setItem('alliancesim.tour.v1', '1'); localStorage.setItem('alliancesim.myday', JSON.stringify(new Date().toDateString())); } catch (e) {}
    });
    await use(page);
    expect(page.errors, 'no console errors').toEqual([]);
  },
});

test.beforeAll(async () => { await fetch(new URL('/__reset', urls().web)).catch(() => {}); });

// Geometry helper: rects of the home pieces, in viewport pixels.
const homeGeometry = (page) => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const wall = document.querySelector('.pwall');
  const pieces = [...document.querySelectorAll('.pwall > *, .pwrow > *, .pgrid .papp, .pdock .papp')].map((el) => ({ cls: el.className, ...r(el) }));
  return {
    vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
    home: r(document.querySelector('[data-scr=home]')), dock: r(document.querySelector('.pdock')),
    chats: r(document.querySelector('.pwchats')), island: r(document.querySelector('.pnotch')),
    islandShown: getComputedStyle(document.querySelector('.pnotch')).display !== 'none',
    wallScroll: wall.scrollHeight - wall.clientHeight, pieces,
    icon: r(document.querySelector('.pgrid .papp .ic')),
  };
});

function expectHomeFits(g, label) {
  expect(g.docW, `${label}: no horizontal page scroll`).toBeLessThanOrEqual(g.vw);
  expect(g.wallScroll, `${label}: home fits without scrolling`).toBeLessThanOrEqual(2);
  for (const p of g.pieces) {
    expect(p.x, `${label}: ${p.cls} inside left edge`).toBeGreaterThanOrEqual(g.home.x - 1);
    expect(p.r, `${label}: ${p.cls} inside right edge`).toBeLessThanOrEqual(g.home.r + 1);
  }
  expect(g.dock.b, `${label}: dock on screen`).toBeLessThanOrEqual(g.home.b + 1);
  expect(g.chats.b, `${label}: widgets end above the dock`).toBeLessThanOrEqual(g.dock.y + 1);
  // Dense like the mockup: the gap between the last widget and the dock stays small.
  expect(g.dock.y - g.chats.b, `${label}: no empty band above the dock`).toBeLessThan(g.home.h * 0.12);
  // Icons keep the mockup proportion (62 of 390).
  expect(g.icon.w / g.home.w, `${label}: icon size ∝ screen`).toBeGreaterThan(0.12);
  expect(g.islandShown, `${label}: Dynamic Island visible`).toBe(true);
  expect(g.island.w, `${label}: island has the pill shape`).toBeGreaterThanOrEqual(100);
  expect(g.island.y, `${label}: island on screen`).toBeGreaterThanOrEqual(0);
}

test.describe('Telegram Mini App', () => {
  test.skip(({ tgPlatform }) => !tgPlatform, 'phone projects only');

  test('fullscreen, island, dense home that fits the screen', async ({ page, tgPlatform }, info) => {
    await page.goto(urls().a.replace('tgWebAppPlatform=tdesktop', 'tgWebAppPlatform=' + tgPlatform));
    await page.waitForSelector('#wMood [data-mood-set]');
    expect(await page.evaluate(() => window.__tgEvents), 'fullscreen requested').toContain('web_app_request_fullscreen');
    expect(await page.evaluate(() => window.__tgEvents), 'vertical swipes disabled').toContain('web_app_setup_swipe_behavior');
    expectHomeFits(await homeGeometry(page), info.project.name);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-home.png`) });
  });

  test('apps: large title, tab bar and FAB stay on screen', async ({ page, tgPlatform }, info) => {
    await page.goto(urls().a.replace('tgWebAppPlatform=tdesktop', 'tgWebAppPlatform=' + tgPlatform));
    await page.waitForSelector('#wMood [data-mood-set]');
    await page.locator('.pdock [data-go=chatlist]').click();
    const bar = page.locator('.ptabbar.on');
    await expect(bar).toBeVisible();
    await page.waitForTimeout(500); // slide-in transition
    const g = await page.evaluate(() => {
      const r = (q) => document.querySelector(q).getBoundingClientRect();
      const tb = r('.ptabbar'), fab = r('[data-scr=chatlist] .phead .act'), lt = r('[data-scr=chatlist] .plt');
      return { vw: innerWidth, vh: innerHeight, tb: { x: tb.x, r: tb.right, b: tb.bottom, y: tb.y }, fab: { r: fab.right, b: fab.bottom }, lt: { h: lt.height } };
    });
    expect(g.tb.x).toBeGreaterThanOrEqual(0); expect(g.tb.r).toBeLessThanOrEqual(g.vw); expect(g.tb.b).toBeLessThanOrEqual(g.vh);
    expect(g.fab.r).toBeLessThanOrEqual(g.vw); expect(g.fab.b, 'FAB above the tab bar').toBeLessThanOrEqual(g.tb.y);
    expect(g.lt.h, 'large title').toBeGreaterThan(30);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-chats.png`) });
    await page.locator('.ptabbar [data-tab-go=contacts]').click();
    await expect(page.locator('#pbody .pscreen.show[data-scr=contacts]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-contacts.png`) });
  });
});

test.describe('Office website', () => {
  test.skip(({ tgPlatform }) => !!tgPlatform, 'web projects only');

  test('phone frame fits the window, lock screen unlocks, home is dense', async ({ page }, info) => {
    await page.goto(urls().web);
    await page.locator('#phoneFab').click({ force: true }); // it floats (animation), so skip the stability wait — a real mouse click
    const lock = page.locator('.plock.on');
    await expect(lock).toBeVisible();
    await page.waitForTimeout(600); // open animation (translate + scale)
    const f = await page.evaluate(() => { const b = document.getElementById('phone').getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; });
    expect(f.x).toBeGreaterThanOrEqual(0); expect(f.y).toBeGreaterThanOrEqual(0);
    expect(f.r).toBeLessThanOrEqual(f.vw); expect(f.b).toBeLessThanOrEqual(f.vh);
    expect(f.w / f.h, 'iPhone proportions').toBeCloseTo(400 / 866, 1);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-lock.png`) });
    await page.locator('.plock .tm').click();
    await expect(lock).toHaveCount(0);
    await page.waitForTimeout(500);
    expectHomeFits(await homeGeometry(page), info.project.name);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-home.png`) });
  });
});
