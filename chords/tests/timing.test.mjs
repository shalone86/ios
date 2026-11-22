// Bluetooth timing: tap along to the clicks 200 ms late (as over wireless
// headphones), and the delay is measured and taken off what is recorded.
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = { chords: path.resolve(here, '../web'), boba: path.resolve(here, '../../bubbloop/web') };
const OUT = fs.mkdtempSync(path.join(process.env.CHORDS_TEST_OUT || os.tmpdir(), 'cozy-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname), m = /^\/(chords|boba)(\/.*)?$/.exec(u);
  if (!m) { s.writeHead(404); s.end(); return; }
  let rel = m[2] || '/'; if (rel.endsWith('/')) rel += 'index.html';
  const f = path.join(ROOTS[m[1]], rel);
  if (!f.startsWith(ROOTS[m[1]]) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true, acceptDownloads: true, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0; const check = (ok, m) => { console.log((ok ? '  ok   ' : '  FAIL ') + m); if (!ok) failed++; };
const probe = (f) => String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).trim();

await page.goto(`${base}/chords/`);
await page.evaluate(() => window.cozy.start());
await page.waitForFunction(() => window.cozy.eng);
await page.click('#menu');
await page.click('[data-do="timing"]');
// tap 0.2 s after each click, as you would hearing them late over Bluetooth
const measured = await page.evaluate(async () => {
  const ctx = window.cozy.eng.ctx, pad = document.querySelector('[data-tap]'), beat = 60 / 96;
  const first = ctx.currentTime + 0.4 + 4 * beat;          // the first click after the four to get ready
  for (let k = 0; k < 8; k++) {
    const at = first + k * beat + 0.2;
    while (ctx.currentTime < at) await new Promise((r) => setTimeout(r, 4));
    pad.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, beat * 1000 + 300));
  return { saved: window.cozy.S.tapDelay, eng: window.cozy.eng.tapDelay, said: document.querySelector('[data-say]').textContent };
});
check(Math.abs(measured.saved - 0.2) < 0.04 && measured.eng === measured.saved && /land \d+ ms late/.test(measured.said), `tapping along 200 ms late measures ${Math.round(measured.saved * 1000)} ms ("${measured.said}")`);
await page.click('#scrim', { position: { x: 20, y: 20 } });
// what is played is recorded that much earlier: a chord pressed at 1.0 s lands at about 0.8 s
const shifted = await page.evaluate(async () => {
  const e = window.cozy.eng;
  e.rec = { start: e.ctx.currentTime, end: 1e9, bars: 99, ev: [] };
  await new Promise((r) => setTimeout(r, 1000));
  const pressed = e.now() - e.rec.start;
  e.press(0, { root: 0, shape: 'maj', label: 'C' }); e.release();
  const ev = e.rec.ev; e.rec = null;
  return { pressed, logged: ev[0].t };
});
check(Math.abs(shifted.pressed - shifted.logged - measured.saved) < 0.002, `a chord played at ${shifted.pressed.toFixed(2)} s is recorded at ${shifted.logged.toFixed(2)} s, back on the beat`);
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all timing checks passed');
process.exit(failed ? 1 : 0);
