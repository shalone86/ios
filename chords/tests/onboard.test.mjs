// First visit: no start screen, the first mug glows, a tap starts the sound,
// and each tip shows once.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]).replace(/^\/chords/, '') || '/';
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (err, d) => { if (err) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); s.end(d); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0; const check = (ok, m) => { console.log((ok ? '  ok   ' : '  FAIL ') + m); if (!ok) failed++; };

await page.goto(`${base}/chords/`);
await page.waitForTimeout(300);
const first = await page.evaluate(() => ({ start: !!document.getElementById('start'), eng: !!window.cozy.eng, glow: getComputedStyle(document.querySelector('.chord[data-i="0"] .cup')).animationName }));
check(!first.start && !first.eng && first.glow === 'bb-glow', `opens straight to the mugs, no sound yet, first mug glows (${first.glow})`);
await page.tap('.chord[data-i="0"]');
await page.waitForFunction(() => window.cozy.eng);
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({ glow: getComputedStyle(document.querySelector('.chord[data-i="0"] .cup')).animationName, tip: document.querySelector('.bb-tip.on')?.textContent || '', state: window.cozy.eng.ctx.state }));
check(after.glow === 'none' && after.state === 'running', `a tap starts the sound (${after.state}) and ends the glow`);
check(/swipe the strings/.test(after.tip), `then a one-line tip: "${after.tip.replace('✕', '')}"`);
await page.tap('#strip');
await page.waitForTimeout(150);
check(!(await page.$('.bb-tip.on')), 'touching the strings hides it');
await page.waitForTimeout(2600);
const rec = await page.evaluate(() => document.querySelector('.bb-tip.on')?.textContent || '');
check(/records 4 bars/.test(rec), `next: "${rec.replace('✕', '')}"`);
await page.click('.bb-tip button');
await page.reload(); await page.waitForTimeout(300);
const again = await page.evaluate(() => ({ glow: getComputedStyle(document.querySelector('.chord[data-i="0"] .cup')).animationName, seen: localStorage.getItem('cozy.tips') }));
await page.tap('.chord[data-i="1"]'); await page.waitForTimeout(200);
check(again.glow === 'none' && !(await page.$('.bb-tip.on')), `coming back: no glow, no repeat tips (${again.seen})`);
check(!errors.length, `no page errors ${errors.join(' ')}`);
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all good'); process.exit(failed ? 1 : 0);
