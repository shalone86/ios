// Films the tutorial: drives the real app at phone size through making a
// song, with captions and a dot where each finger lands, records the screen
// and the app's own sound, and joins them into web/media/tutorial.mp4.
//
//   node bubbloop/tools/make-tutorial.mjs
//
// Needs Playwright with Chromium, and ffmpeg. Re-run it when the app changes.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../web');
const OUT = path.join(WEB, 'media/tutorial.mp4');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-tour-'));
const require = createRequire(import.meta.url);
let pw;
for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }

// ---------- a tiny static server for web/ ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// ---------- the browser, filming ----------
const W = 405, H = 720;
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  recordVideo: { dir: work, size: { width: W * 2, height: H * 2 } },
});
await context.addInitScript(() => { try { localStorage.setItem('bubbloop.seenTour', '1'); } catch (e) { /* fine */ } });
const page = await context.newPage();
const videoStart = Date.now();
page.on('pageerror', (e) => console.error('page error:', e));
await page.goto(url);

const wait = (ms) => page.waitForTimeout(ms);

// captions and finger dots, drawn over the app
await page.addStyleTag({ content: `
  #tt-cap { position: fixed; left: 14px; right: 14px; bottom: 76px; z-index: 99; text-align: center; pointer-events: none;
    font: 700 19px Fredoka, sans-serif; color: #fff; line-height: 1.25; padding: 12px 16px; border-radius: 20px;
    background: rgba(35, 20, 85, 0.88); box-shadow: 0 10px 30px rgba(10, 5, 40, 0.45); transition: opacity .25s, transform .25s; }
  #tt-cap.off { opacity: 0; transform: translateY(8px); }
  #tt-cap small { display: block; font-weight: 500; font-size: 14px; opacity: .85; margin-top: 3px; }
  .tt-dot { position: fixed; z-index: 98; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; pointer-events: none;
    background: rgba(255, 255, 255, .45); border: 3px solid rgba(255, 255, 255, .95); box-shadow: 0 0 18px rgba(255, 255, 255, .6); transition: opacity .3s, transform .3s; }
  .tt-dot.up { opacity: 0; transform: scale(1.5); }
  #tt-end { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; text-align: center; color: #fff;
    background: linear-gradient(180deg, #231a55, #7a4aa8 60%, #ffb98f); font: 700 44px Fredoka, sans-serif; }
  #tt-end small { display: block; font-size: 18px; font-weight: 500; margin-top: 10px; opacity: .9; }
` });
await page.evaluate(() => {
  const c = document.createElement('div'); c.id = 'tt-cap'; c.className = 'off'; document.body.appendChild(c);
  // a dot that follows a press: down / move / up
  window.__dot = { down(x, y) { const d = document.createElement('div'); d.className = 'tt-dot'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); return d; },
    move(d, x, y) { d.style.left = x + 'px'; d.style.top = y + 'px'; }, up(d) { d.classList.add('up'); setTimeout(() => d.remove(), 350); } };
  // press an element like a finger: pointer events where the app listens for them, a click otherwise
  window.__press = async (el, hold = 140, opts = {}) => {
    const b = el.getBoundingClientRect(), x = b.left + b.width / 2 + (opts.dx || 0), y = b.top + b.height / 2 + (opts.dy || 0);
    const id = 100 + Math.floor(Math.random() * 1e6);
    const fire = (type, yy = y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: !opts.secondary, clientX: x, clientY: yy, bubbles: true, cancelable: true }));
    const dot = window.__dot.down(x, y);
    if (opts.pointer) fire('pointerdown');
    if (opts.wiggle) {
      const t0 = performance.now();
      while (performance.now() - t0 < hold) {
        const k = (performance.now() - t0) / 1000, yy = y - Math.sin(k * 2 * Math.PI * 5) * b.height * 0.28;
        window.__dot.move(dot, x, yy); fire('pointermove', yy);
        await new Promise((r) => setTimeout(r, 16));
      }
    } else await new Promise((r) => setTimeout(r, hold));
    if (opts.pointer) fire('pointerup'); else el.click();
    window.__dot.up(dot);
  };
  // play notes in time with the loop: [{ t, d, r, c, wig }] in ticks (96 per beat),
  // starting at the next loop pass (or right after the count-in)
  window.__perform = async (notes) => {
    const e = window.bubbloop.engine;
    let pos = e.position();
    while (!pos) { await new Promise((r) => setTimeout(r, 10)); pos = e.position(); }
    const start = pos.countIn ? 0 : pos.seg.start + pos.seg.len;
    const lat = e.latency();
    await Promise.all(notes.map((n) => new Promise((done) => {
      const at = e.timeAt(start + n.t) + lat;
      setTimeout(async () => {
        const cell = document.querySelector(`#grid .cell[data-r="${n.r}"][data-c="${n.c}"]`);
        await window.__press(cell, n.d * (60000 / (window.bubbloop.project.bpm * 96)), { pointer: true, wiggle: n.wig, secondary: true });
        done();
      }, Math.max(0, (at - e.now) * 1000 - 4));
    })));
  };
});
const cap = (text, sub = '') => page.evaluate(([t, s]) => {
  const c = document.getElementById('tt-cap');
  c.innerHTML = t ? `${t}${s ? `<small>${s}</small>` : ''}` : '';
  c.className = t ? '' : 'off';
}, [text, sub]);
const press = (sel, hold = 140, opts = {}) => page.evaluate(([s, h, o]) => window.__press(document.querySelector(s), h, o), [sel, hold, opts]);
const bubble = (r, c, hold = 160, opts = {}) => press(`#grid .cell[data-r="${r}"][data-c="${c}"]`, hold, { pointer: true, ...opts });
const pod = (role) => page.evaluate((rl) => {
  const t = window.bubbloop.project.tracks.find((x) => x.role === rl);
  return window.__press(document.querySelector(`.pod[data-track="${t.id}"]`), 160);
}, role);
const perform = (notes) => page.evaluate((n) => window.__perform(n), notes);
const closeSheet = () => page.evaluate(() => window.__press(document.getElementById('scrim'), 80));

// ---------- start recording the app's sound ----------
async function startAudio() {
  return page.evaluate(() => {
    const e = window.bubbloop.engine;
    const dest = e.ctx.createMediaStreamDestination();
    window.__tapOut = () => { try { e.g.master.output.connect(dest); } catch (err) { /* already */ } };
    window.__tapOut();
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    const chunks = [];
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    rec.start(250);
    window.__stopAudio = () => new Promise((resolve) => {
      rec.onstop = async () => {
        const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        resolve(btoa(s));
      };
      rec.stop();
    });
    return Date.now();
  });
}

// ================= the tutorial =================
const t0 = Date.now();
await wait(900);
await cap('Boba Beats', 'make a song out of bubbles');
await wait(2200);
await press('#btn-start', 200);
await page.waitForFunction(() => window.bubbloop && window.bubbloop.engine.ready);
// a fresh song to build
await page.evaluate(async () => {
  const S = await import('/js/state.js');
  const { openProject } = await import('/js/ui/app.js');
  const p = S.newProject('My first song');
  p.bpm = 96;
  await openProject(p);
});
const audioStart = await startAudio();

await cap('Every bubble is in tune', 'tap around: nothing can sound wrong');
await pod('melody');
const firstTap = Date.now();
for (const [r, c] of [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [2, 0], [2, 2], [1, 4], [1, 2]]) { await bubble(r, c, 150); await wait(90); }
await wait(500);

await cap('Pick a key and a scale', 'every track follows it');
await press('#btn-key', 160); await wait(700);
await press('[data-key="9"]', 160); await wait(500);
await press('[data-scale="minor"]', 160); await wait(1300);
await closeSheet(); await wait(500);

await cap('Start with drums', 'choose a groove, or tap your own');
await pod('drums'); await wait(500);
await press('[data-tool="grooves"]', 160); await wait(800);
await press('[data-groove="lofi"]', 180); await wait(2600);
await closeSheet();
await cap('Drums are 25 pads', 'kicks, snares, hats, toms, shakers…');
await wait(1200);
for (const [r, c] of [[2, 0], [2, 2], [3, 0], [3, 1]]) { await bubble(r, c, 120); await wait(240); }
await wait(800);

await cap('Now the bass. Press the pink button', 'after a one-bar count-in, it records');
await pod('bass'); await wait(400);
await press('#btn-rec', 160);
await perform([
  { t: 0, d: 70, r: 0, c: 0 }, { t: 144, d: 40, r: 0, c: 0 }, { t: 288, d: 80, r: 0, c: 2 },
  { t: 384, d: 70, r: 0, c: 3 }, { t: 528, d: 40, r: 0, c: 3 }, { t: 672, d: 80, r: 0, c: 4 },
]);
await cap('It keeps looping', 'notes snap to the beat');
await wait(1800);
await press('#btn-rec', 160);

await cap('Chords: one bubble, a whole chord');
await pod('pads'); await wait(400);
await press('[data-tool="chord"]', 160); await wait(700);
await press('[data-chord="seven"]', 180); await wait(500);
await press('#btn-rec', 160);
await perform([{ t: 0, d: 360, r: 1, c: 0 }, { t: 384, d: 360, r: 1, c: 3 }]);
await press('#btn-rec', 160);

await cap('A melody on top', 'wiggle a held bubble to bend the note');
await pod('melody'); await wait(400);
await press('#btn-rec', 160);
await perform([
  { t: 0, d: 40, r: 2, c: 0 }, { t: 48, d: 40, r: 2, c: 2 }, { t: 96, d: 40, r: 2, c: 3 }, { t: 144, d: 200, r: 2, c: 4, wig: true },
  { t: 384, d: 40, r: 2, c: 3 }, { t: 432, d: 40, r: 2, c: 2 }, { t: 480, d: 220, r: 2, c: 0 },
]);
await press('#btn-rec', 160);
await wait(400);

await cap('Tap zzz to rest a track', 'tap again to wake it');
await page.evaluate(() => { const t = window.bubbloop.project.tracks.find((x) => x.role === 'drums'); return window.__press(document.querySelector(`[data-mute="${t.id}"]`), 160); });
await wait(2600);
await page.evaluate(() => { const t = window.bubbloop.project.tracks.find((x) => x.role === 'drums'); return window.__press(document.querySelector(`[data-mute="${t.id}"]`), 160); });
await wait(1200);

await cap('FX: hold a pad', 'slide across Stutter or Dive to change it');
await press('.tab[data-view="fx"]', 160); await wait(700);
await press('.fx[data-fx="stutter"]', 1100, { pointer: true }); await wait(500);
await press('.fx[data-fx="filter"]', 1600, { pointer: true, dx: -40 }); await wait(500);
await press('.fx[data-fx="reverb"]', 1400, { pointer: true, dx: 30 }); await wait(900);

await cap('Make a second section', 'B starts as a copy of A');
await press('.tab[data-view="play"]', 160); await wait(500);
await press('[data-sec="add"]', 160); await wait(700);
await press('[data-new="copy"]', 180); await wait(900);
await pod('drums'); await wait(300);
await press('[data-tool="grooves"]', 160); await wait(600);
await press('[data-groove="boombap"]', 180); await wait(1500);
await closeSheet(); await wait(1500);
await press('#btn-play', 160); await wait(400);

await cap('Song mode: line your loops up', 'each column is a part of the song');
await press('.tab[data-view="song"]', 160); await wait(800);
await press('[data-song="build"]', 180); await wait(1200);
await cap('Tap a bubble to rest a track there', 'hold one for fills and energy');
await page.evaluate(() => { const t = window.bubbloop.project.tracks.find((x) => x.role === 'melody'); return window.__press(document.querySelector(`[data-cell="0:${t.id}"]`), 160); });
await wait(900);
await page.evaluate(() => { const t = window.bubbloop.project.tracks.find((x) => x.role === 'drums'); return window.__press(document.querySelector(`[data-cell="1:${t.id}"]`), 160); });
await wait(300);
await page.evaluate(() => { const t = window.bubbloop.project.tracks.find((x) => x.role === 'drums'); return window.__press(document.querySelector('.sec.block'), 10).then(() => import('/js/ui/sheets.js')).then((m) => m.openSheets.spice(1, t.id)); });
await wait(900);
await press('[data-fill="rep16"]', 180); await wait(1000);
await closeSheet(); await wait(300);
await page.evaluate(() => { window.bubbloop.engine.songFrom = 0; window.bubbloop.songSel = 0; });
await cap('Press play to hear the whole song');
await press('#btn-play', 160);
await wait(Math.round(4 * 4 * 60000 / 96) + 400);
await press('#btn-play', 160); await wait(300);

await cap('Mix: volume, Cloud and Echo for each track');
await press('.tab[data-view="mix"]', 160); await wait(2200);

await cap('Export a mastered file', 'WAV, MP3, Apple Lossless, MIDI, stems');
await press('#btn-export', 160); await wait(1500);
await press('[data-what="song"]', 160); await wait(1800);
await closeSheet(); await wait(300);

await cap('More in the menus', 'a sampler for your own sounds, saved songs, MIDI');
await press('#btn-project', 160); await wait(2400);
await closeSheet(); await cap(''); await wait(300);

await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'tt-end';
  d.innerHTML = '<div>Boba Beats<small>now make your own song ✦</small></div>';
  document.body.appendChild(d);
});
await wait(2500);

// ---------- finish: join picture and sound ----------
const audioB64 = await page.evaluate(() => window.__stopAudio());
const total = (Date.now() - t0) / 1000;
await page.close();
const webm = await page.video().path();
await context.close(); await browser.close(); server.close();
const audioFile = path.join(work, 'audio.webm');
fs.writeFileSync(audioFile, Buffer.from(audioB64, 'base64'));
const offset = (audioStart - videoStart) / 1000;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const TRIM = 0.8;          // the blank first moment while the page loads
const delayMs = Math.round((offset - TRIM) * 1000);
execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
  '-ss', String(TRIM), '-i', webm, '-i', audioFile,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
  '-vf', 'scale=720:1280:flags=lanczos',
  '-c:a', 'aac', '-b:a', '128k', '-af', `adelay=${delayMs}:all=1,loudnorm=I=-16:TP=-1.5,apad`,
  '-shortest', OUT], { stdio: 'inherit' });
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`tutorial: ${OUT} (${mb} MB, ${total.toFixed(0)} s, audio offset ${offset.toFixed(2)} s, first tap at ${((firstTap - videoStart) / 1000 - TRIM).toFixed(2)} s in the video)`);
fs.rmSync(work, { recursive: true, force: true });
