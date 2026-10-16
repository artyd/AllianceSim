// Headless browser helpers (puppeteer-core + a locally installed Chrome/Edge) for Mini App
// checks against tests/devstack.mjs. Chrome path: $CHROME, else the usual install paths.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TMP = path.resolve(fileURLToPath(new URL('./.tmp/', import.meta.url)));
export const URLS = JSON.parse(fs.readFileSync(path.join(TMP, 'urls.json'), 'utf8'));
export const SHOTS = path.join(TMP, 'shots') + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));

let browser;
export async function launch() {
  const r = await fetch(new URL('/__reset', URLS.web)); if (!r.ok) throw new Error('reset failed: ' + await r.text());
  if (!CHROME) throw new Error('no Chrome found — set CHROME=/path/to/chrome');
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  return browser;
}
export async function close() { await browser.close(); }

export async function openAs(who, { tour = false, myday = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
  // The first-run tour overlay is covered by its own scenario; skip it elsewhere.
  if (!tour) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('alliancesim.tour.v1', '1'); } catch (e) {} });
  // «Мій день» opens once a day — keep it out of scenarios that don't test it
  if (!myday) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('alliancesim.myday', JSON.stringify(new Date().toDateString())); } catch (e) {} });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) page.errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) page.errors.push('http ' + r.status() + ' ' + r.url().slice(0, 90)); });
  page.on('requestfailed', (r) => { if (!/telegram\.org|fonts\.g/.test(r.url())) page.errors.push('reqfail: ' + r.url()); });
  await page.goto(URLS[who], { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  page.who = who;
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function shot(page, name) { await page.screenshot({ path: SHOTS + name + '.png' }); }
// Click the first visible element matching sel inside the topmost visible phone screen (or document).
export async function tap(page, sel, { inScreen = true } = {}) {
  const ok = await page.evaluate((sel, inScreen) => {
    const root = inScreen ? topScreen() : document;
    function topScreen() {
      const shown = [...document.querySelectorAll('#pbody .pscreen.show')];
      shown.sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0));
      return shown[0] || document.querySelector('#pbody [data-scr=home]');
    }
    const el = root.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, sel, inScreen);
  if (!ok) throw new Error(`[${page.who}] tap: no ${sel}`);
  await sleep(450);
}
export async function type(page, sel, text) {
  await page.evaluate((sel, text) => {
    const shown = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0));
    const root = shown[0] || document;
    const el = root.querySelector(sel);
    if (!el) throw new Error('no ' + sel);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, sel, text);
}
export async function key(page, sel, k) {
  await page.evaluate((sel, k) => {
    const shown = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0));
    const el = (shown[0] || document).querySelector(sel);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  }, sel, k);
  await sleep(450);
}
export const text = (page, sel = null) => page.evaluate((sel) => {
  const shown = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0));
  const root = shown[0] || document.querySelector('#pbody [data-scr=home]');
  const el = sel ? root.querySelector(sel) : root;
  return el ? el.innerText : null;
}, sel);
export const js = (page, fn, ...a) => page.evaluate(fn, ...a);
export async function home(page) { await page.evaluate(() => { if (document.querySelector('#pbody .pscreen.show')) document.getElementById('pbar').click(); }); await sleep(500); }

let fails = 0, passes = 0;
export function ok(c, m) { if (c) passes++; else { fails++; console.log('  ✗ ' + m); } }
export function report() { console.log(`\n${passes} passed, ${fails} failed`); return fails; }
// Wipe this user's tasks/events/prefs through the API, then reload the Mini App.
export async function reset(page) {
  await page.evaluate(async () => {
    const h = { 'X-Telegram-Init-Data': Telegram.WebApp.initData, 'content-type': 'application/json' };
    const f = (m, p, b) => fetch('/api' + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
    for (const t of await f('GET', '/me/tasks')) await f('DELETE', '/me/tasks/' + t.id);
    for (const e of await f('GET', '/me/events?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')) await f('DELETE', '/me/events/' + e.id);
    await f('PUT', '/me/prefs', { messages: true, events: true, tasks: true, digest: true });
  });
  await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
}
