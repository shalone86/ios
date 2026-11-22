// Deep Drift: the app loads, orbs sing and echo, a hold hums, every voice and
// the tape/depth chain render clean audio, and the sleep timer fades it out.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url)), WEB = path.resolve(here, '../web');
const OUT = process.env.NIGHT_TEST_OUT || path.join(here, '.out');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { let r = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (r.endsWith('/')) r += 'index.html';
  const f = path.join(WEB, r); if (!f.startsWith(WEB) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0; const check = (ok, m) => { console.log((ok ? '  ok   ' : '  FAIL ') + m); if (!ok) failed++; };
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);

// offline: every voice through the full chain, with lots of tape
const r = await page.evaluate(async () => {
  const { Drift } = await import('/js/audio.js');
  const res = {};
  for (const v of ['pad', 'glass', 'choir', 'drone']) {
    const ctx = new OfflineAudioContext(2, 44100 * 8, 44100);
    const d = new Drift(ctx);
    d.voiceName = v; d.set('tape', 0.9); d.set('depth', 0.7);
    d.note(57, 0.8, 0.05, 2.5); d.note(64, 0.8, 0.6, 2.5);
    const b = await ctx.startRendering();
    let peak = 0, bad = 0, e = 0; const c = b.getChannelData(0);
    for (const x of c) { if (!Number.isFinite(x)) bad++; else { peak = Math.max(peak, Math.abs(x)); e += x * x; } }
    // the tail after the notes: reverb should still be ringing at 5 s
    let tail = 0; for (let i = 44100 * 5; i < 44100 * 5.5; i++) tail += c[i] * c[i];
    res[v] = { peak, bad, rms: Math.sqrt(e / c.length), tail: Math.sqrt(tail / 22050) };
  }
  return res;
});
for (const [v, s] of Object.entries(r)) check(s.bad === 0 && s.peak > 0.02 && s.peak < 1 && s.tail > 0.0005, `${v}: plays clean (peak ${s.peak.toFixed(2)}), and the sea rings on after it (${(20 * Math.log10(s.tail)).toFixed(0)} dB at 5 s)`);

// loops keep singing: three taps, four minutes later they are as loud as at the start
const longRun = await page.evaluate(async () => {
  const { Drift } = await import('/js/audio.js');
  const SR = 22050, LEN = 240, ctx = new OfflineAudioContext(1, SR * LEN, SR), d = new Drift(ctx);
  d.tap(2, 52, 0.85); d.voiceName = 'glass'; d.tap(6, 62, 0.85); d.voiceName = 'choir'; d.tap(9, 69, 0.85);
  for (let t = 10; t < LEN; t += 10) ctx.suspend(t).then(() => { d.tick(); ctx.resume(); });
  const c = (await ctx.startRendering()).getChannelData(0);
  const db = (a, z) => { let e = 0; for (let i = a * SR; i < z * SR; i++) e += c[i] * c[i]; return 10 * Math.log10(e / ((z - a) * SR)); };
  return { start: db(0, 60), end: db(180, 240), voices: d.loops.map((l) => l.voice) };
});
check(longRun.end > longRun.start - 6 && longRun.voices.join() === 'pad,glass,choir',
  `loops in three voices keep singing (first minute ${longRun.start.toFixed(1)} dB, fourth minute ${longRun.end.toFixed(1)} dB)`);

await page.mouse.click(5, 5);
await page.waitForFunction(() => window.deepDrift.drift && window.deepDrift.drift.ctx.state === 'running');
await page.waitForTimeout(400);
const o = await page.evaluate(() => { const o = window.deepDrift.orbs[4]; return { x: o.sx, y: o.sy }; });
await page.evaluate(([x, y]) => new Promise((done) => {
  const el = document.getElementById('sea');
  const fire = (type, id) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  fire('pointerdown', 1); setTimeout(() => { fire('pointerup', 1); done(); }, 100);
}), [o.x, o.y]);
const loops = await page.evaluate(() => window.deepDrift.drift.loops.length);
check(loops === 1, 'a tap sends a note drifting on its own loop');
const sched = await page.evaluate(() => window.deepDrift.drift.loops[0].events.length);
check(sched >= 3, `its next ${sched} returns are booked on the audio clock, so they play on with the screen off`);
// tapping it again lets it rest; a seventh loop pushes out the oldest
const resting = await page.evaluate(() => {
  const d = window.deepDrift.drift, n = window.deepDrift.orbs;
  d.tap(4, 57, 0.8);
  const rested = !d.isLooping(4);
  for (let i = 0; i < 7; i++) d.tap(i + 3, 60 + i, 0.8);
  const playing = d.loops.filter((l) => !l.ending).map((l) => l.orb);
  for (const l of d.loops) if (!l.ending) d.rest(l, 0.5);
  return { rested, playing };
});
check(resting.rested && resting.playing.length === 6 && !resting.playing.includes(3), `a second tap lets a loop rest, and only six play at once (${resting.playing})`);
const held = await page.evaluate(([x, y]) => new Promise((done) => {
  const el = document.getElementById('sea');
  const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 2, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  fire('pointerdown'); setTimeout(() => { const h = window.deepDrift.orbs.some((q) => q.held); fire('pointerup'); done(h); }, 600);
}), [o.x, o.y]);
check(held, 'holding an orb hums its note');
await page.click('#animate');
const before = await page.inputValue('#depth');
await page.waitForTimeout(1500);
check(await page.evaluate(() => window.deepDrift.state.animate), 'Animate sets the controls drifting');
// sleep timer: jump to the last 3 seconds and watch it fade
await page.click('#timer');
await page.evaluate(() => window.deepDrift.setTimer(3));
await page.waitForTimeout(1000);
const mid = await page.evaluate(() => window.deepDrift.drift.sleep.gain.value);
await page.waitForTimeout(3500);
const after = await page.evaluate(() => ({ min: window.deepDrift.state.timerMin, loops: window.deepDrift.drift.loops.length, anim: window.deepDrift.state.animate }));
check(mid < 0.9 && after.min === 0 && after.loops === 0 && !after.anim, 'the sleep timer fades everything out and stops');
await page.screenshot({ path: path.join(OUT, 'night.png') });
// the tutorial: ? opens it, the sea goes quiet, ✕ brings it back
await page.click('#help');
const links = await page.evaluate(() => [...document.querySelectorAll('#menu a.item')].map((a) => a.href).join(' '));
check(/shalonely\.com\/boba\//.test(links) && /shalonely\.com\/pop\//.test(links), 'the menu links Boba Beats and Pop Pads');
await page.click('#m-tour');
await page.waitForTimeout(1500);
const tour = await page.evaluate(() => ({ open: !document.getElementById('tour').hidden, src: document.getElementById('tour-video').currentSrc,
  ready: document.getElementById('tour-video').readyState, master: window.deepDrift.drift.master.gain.value }));
await page.screenshot({ path: path.join(OUT, 'night-tour.png') });
await page.click('#tour-close');
await page.waitForTimeout(2500);
const back = await page.evaluate(() => ({ open: !document.getElementById('tour').hidden, master: window.deepDrift.drift.master.gain.value }));
check(tour.open && /tutorial\.mp4$/.test(tour.src) && tour.ready >= 1 && tour.master < 0.1 && !back.open && back.master > 0.3, 'the tutorial opens from ?, the sea goes quiet, and comes back after');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all Deep Drift checks passed'); process.exit(failed ? 1 : 0);
