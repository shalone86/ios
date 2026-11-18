// Films the Pop Pads tutorial: drives the real app at phone size, with
// captions, a spoken line for each step and a dot where each finger lands.
// It records the screen and the app's own sound, lays the narration over it
// (the beat dips under the voice) and writes web/media/tutorial.mp4.
//
// The narration is your own: tools/tutorial-voice/own/<line>.wav, recorded in
// Voice Booth (shalonely.com/record, "Pop Pads tutorial"). A line with no
// recording is left out, along with the part of the film that goes with it.
//
//   node pop/tools/make-tutorial.mjs
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
const OUT = process.env.TUTORIAL_OUT || path.join(WEB, 'media/tutorial.mp4');
const OWN = process.env.TUTORIAL_VOICE || path.join(here, 'tutorial-voice/own');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-tour-'));
const require = createRequire(import.meta.url);
let pw;
for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }

// ---------- narration: trim each take by its own noise level, even out the volume ----------
const KEYS = ['intro', 'tap', 'melody', 'hold', 'stutter', 'jumble', 'flavor', 'record', 'metro', 'steps', 'shape', 'pitch', 'locks', 'tune', 'copy', 'chain', 'knobs', 'motion', 'export', 'bye'];
const clips = {};
const db = (file, flt) => {
  const o = String(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${file}" -af "${flt}volumedetect" -f null - 2>&1 | grep mean_volume || true`]));
  const m = o.match(/mean_volume: ([-0-9.]+)/); return m ? +m[1] : -90;
};
for (const key of KEYS) {
  const src = fs.existsSync(OWN) && fs.readdirSync(OWN).find((f) => path.parse(f).name === key);
  if (!src) continue;
  const inp = path.join(OWN, src), file = path.join(work, `${key}.mp3`);
  // the room's own hiss, from the first quarter second, sets where "silence" ends
  const floor = db(inp, 'atrim=0:0.25,highpass=f=70,');
  const thr = Math.min(-30, Math.max(-60, Math.round(floor + 12)));
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', inp, '-af',
    `highpass=f=70,silenceremove=start_periods=1:start_threshold=${thr}dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=${thr}dB:start_silence=0.2,areverse,afade=t=in:d=0.04,loudnorm=I=-17:TP=-2`,
    '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', file]);
  const secs = parseFloat(String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])));
  clips[key] = { file, seconds: secs };
}
console.log(`narration: ${Object.keys(clips).length} of ${KEYS.length} lines recorded (${KEYS.filter((k) => !clips[k]).join(', ') || 'all'} missing), ${Object.values(clips).reduce((a, c) => a + c.seconds, 0).toFixed(0)} s`);

// ---------- a tiny static server for web/ ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

// ---------- the browser, filming ----------
const W = 405, H = 720;
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await context.addInitScript(() => { try { if (!sessionStorage.getItem('filming')) { localStorage.clear(); sessionStorage.setItem('filming', '1'); } } catch (e) { /* fine */ } });
const page = await context.newPage();
const framesDir = path.join(work, 'frames');
fs.mkdirSync(framesDir);
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', (f) => {
  const file = path.join(framesDir, `${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp * 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * 2, maxHeight: H * 2 });
page.on('pageerror', (e) => console.error('page error:', e));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
const wait = (ms) => page.waitForTimeout(ms);

await page.addStyleTag({ content: `
  #toast, #apk { display: none !important; }
  #tt-cap { position: fixed; left: 14px; right: 14px; top: 50%; transform: translateY(-50%); z-index: 99; text-align: center; pointer-events: none;
    font: 600 19px Fredoka, sans-serif; color: var(--c0); line-height: 1.25; padding: 12px 16px; border-radius: 20px;
    background: rgba(255, 248, 239, .94); box-shadow: 0 10px 30px rgba(0,0,0,.35); transition: opacity .25s; }
  #tt-cap.off { opacity: 0; }
  #tt-cap.low { top: auto; bottom: 26px; transform: none; }
  #tt-cap.high { top: 120px; transform: none; }
  #tt-cap small { display: block; font-weight: 400; font-size: 14px; opacity: .8; margin-top: 3px; }
  .tt-dot { position: fixed; z-index: 98; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none;
    background: rgba(255,255,255,.4); border: 3px solid rgba(255,255,255,.95); box-shadow: 0 0 16px rgba(255,255,255,.6); transition: opacity .3s, transform .3s; }
  .tt-dot.up { opacity: 0; transform: scale(1.5); }
  #tt-end { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; text-align: center; color: #fff8ef;
    background: radial-gradient(circle at 50% 40%, var(--c1), var(--c0) 70%); font: 600 46px Fredoka, sans-serif; }
  #tt-end small { display: block; font-size: 18px; font-weight: 400; margin-top: 10px; opacity: .85; }
` });
await page.evaluate(() => {
  const c = document.createElement('div'); c.id = 'tt-cap'; c.className = 'off'; document.body.appendChild(c);
  window.__dot = { down(x, y) { const d = document.createElement('div'); d.className = 'tt-dot'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); return d; },
    move(d, x, y) { d.style.left = x + 'px'; d.style.top = y + 'px'; }, up(d) { d.classList.add('up'); setTimeout(() => d.remove(), 350); } };
  const centre = (el) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
  // tap a button
  window.__press = async (sel) => {
    const el = document.querySelector(sel); if (!el) return;
    const [x, y] = centre(el), d = window.__dot.down(x, y);
    await new Promise((r) => setTimeout(r, 150)); el.click(); window.__dot.up(d);
  };
  // a finger on a pad or step: down, optional slides (dy over time), up
  window.__touch = async (sel, hold, path = []) => {
    const el = document.querySelector(sel); if (!el) return;
    const [x, y] = centre(el), id = 500 + Math.floor(Math.random() * 1e5);
    const fire = (t, yy) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: yy, bubbles: true, cancelable: true }));
    const d = window.__dot.down(x, y);
    fire('pointerdown', y);
    let t0 = performance.now();
    for (const [ms, dy] of path) {
      const from = d._dy || 0, start = performance.now();
      while (performance.now() - start < ms) {
        const k = (performance.now() - start) / ms, yy = y - (from + (dy - from) * k);
        window.__dot.move(d, x, yy); fire('pointermove', yy);
        await new Promise((r) => setTimeout(r, 30));
      }
      d._dy = dy;
    }
    const left = hold - (performance.now() - t0);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    fire('pointerup', y - (d._dy || 0)); window.__dot.up(d);
  };
  // drag a slider's thumb to a value over `ms`
  window.__slide = async (sel, to, ms) => {
    const el = document.querySelector(sel); if (!el) return;
    const b = el.getBoundingClientRect(), min = +el.min, max = +el.max, from = +el.value;
    const xOf = (v) => b.left + 11 + (b.width - 22) * (v - min) / (max - min), y = b.top + b.height / 2;
    const d = window.__dot.down(xOf(from), y), t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.value = Math.round(from + (to - from) * e);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      window.__dot.move(d, xOf(+el.value), y);
      if (k >= 1) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    window.__dot.up(d);
  };
});
const cap = (text, sub = '', where = '') => page.evaluate(([t, s, w]) => {
  const c = document.getElementById('tt-cap');
  c.innerHTML = t ? `${t}${s ? `<small>${s}</small>` : ''}` : '';
  c.className = t ? w : 'off';
}, [text, sub, where]);
const spoken = [];
let sayEnd = 0, audioT0 = 0;
// speak a line (if it was recorded) and show its caption; false if it wasn't
async function say(key, text, sub = '', where = 'low') {
  if (!clips[key]) return false;
  const now = Date.now();
  if (sayEnd > now) await wait(sayEnd - now + 250);
  const at = Date.now();
  spoken.push({ key, at: (at - audioT0) / 1000 });
  sayEnd = at + clips[key].seconds * 1000;
  await cap(text, sub, where);
  return true;
}
const finishLine = async () => { const left = sayEnd - Date.now(); if (left > 0) await wait(left + 250); };
const press = (sel) => page.evaluate((s) => window.__press(s), sel);
const touch = (sel, hold, p = []) => page.evaluate(([s, h, q]) => window.__touch(s, h, q), [sel, hold, p]);
const slide = (sel, to, ms = 1500) => page.evaluate(([a, b, c]) => window.__slide(a, b, c), [sel, to, ms]);
const pad = (i) => `.pad[data-pad="${i}"]`;
// close a menu the way a person does: tap above it, outside the sheet
const closeMenu = () => page.evaluate(async () => { const d = window.__dot.down(innerWidth / 2, 60); await new Promise((r) => setTimeout(r, 150)); document.getElementById('scrim').click(); window.__dot.up(d); });
const taps = async (list, gap) => { for (const i of list) { await touch(pad(i), 90); await wait(gap); } };

// ================= the tutorial =================
const t0 = Date.now();
await wait(1200);
// record the app's own sound from the moment it starts
await press('#go');
await page.waitForFunction(() => window.popPads.eng && window.popPads.eng.bufs);
const audioStart = await page.evaluate(() => {
  const e = window.popPads.eng, dest = e.ctx.createMediaStreamDestination();
  e.graph.limit.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
  const chunks = []; rec.ondataavailable = (ev) => chunks.push(ev.data); rec.start(250);
  window.__stopAudio = () => new Promise((resolve) => {
    rec.onstop = async () => {
      const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      resolve(btoa(s));
    };
    rec.stop();
  });
  return Date.now();
});
audioT0 = audioStart;
await wait(400);
await say('intro', 'Pop Pads', 'a fizzy little drum machine', '');
await finishLine();

if (await say('tap', 'Tap a bubble to play a drum', 'kicks and snares on the bottom row', 'low')) {
  await wait(900);
  await taps([0, 4, 2, 4, 0, 0, 2, 4], 170);
  await finishLine();
}
if (await say('melody', 'Bass, chord and lead', 'in every flavor · real notes', 'high')) {
  await wait(700);
  for (const i of [1, 1, 14, 15, 1, 14]) { await touch(pad(i), 120); await wait(420); }
  await finishLine();
}
await press('#play'); await wait(600);
if (await say('hold', 'Hold a bubble', 'it repeats in time', 'low')) { await wait(400); await touch(pad(5), 2200); await finishLine(); }
if (await say('stutter', 'Keep holding, slide up', 'to stutter · further = tighter', 'low')) {
  await wait(500); await touch(pad(10), 4600, [[700, 0], [900, 60], [1400, 60], [900, 150], [600, 150]]);
  await finishLine();
}
if (await say('jumble', 'Slide down to jumble', 'let go, and it snaps back', 'low')) {
  await wait(300); await touch(pad(10), 3800, [[500, 0], [900, -90], [2000, -120]]);
  await finishLine();
}
if (await say('flavor', 'Flavors', 'a different kit · the beat stays', 'high')) {
  await wait(500); await press('#kit'); await wait(900);
  await press('[data-kit="lime"]'); await wait(1600);
  await press('[data-kit="cream"]'); await wait(1600);
  await press('[data-kit="cola"]'); await wait(900);
  await closeMenu();
  await finishLine();
}
await press('#play'); await wait(300);
if (await say('record', 'Record', 'four clicks, then play along', 'low')) {
  await wait(800);
  await page.evaluate(() => { const s = window.popPads.song; s.patterns[0][3] = 0; });
  await press('#rec');
  const beat = 60000 / 92;
  await wait(beat * 4 - 60);
  for (let k = 0; k < 2; k++) { await wait(beat - 90); await touch(pad(3), 90); await wait(beat - 90); await touch(pad(3), 90); }
  await finishLine();
  await press('#rec');
}
if (await say('metro', 'The metronome', 'helps you keep time', 'low')) { await wait(400); await press('#metro'); await wait(2600); await press('#metro'); await finishLine(); }

if (await say('steps', 'Steps', 'pick a drum, tap where it plays', 'low')) {
  await press('[data-mode="steps"]'); await wait(700);
  await press('[data-sel="7"]'); await wait(500);
  for (const s of [2, 6, 10, 14]) { await touch(`.step[data-step="${s}"]`, 120); await wait(350); }
  await finishLine();
}
if (await say('shape', 'Shape that drum', 'pitch, length, filter, volume…', 'high')) {
  await slide('#pad-panel [data-key="filt"]', -45, 1300);
  await slide('#pad-panel [data-key="len"]', 45, 1100);
  await finishLine();
}
if (await say('pitch', 'Pitch', 'a 3rd, a 4th, a 5th, an octave', 'high')) {
  await press('[data-sel="14"]'); await wait(700);
  for (let k = 0; k < 4; k++) { await press('#pitch-up'); await wait(650); }
  for (let k = 0; k < 4; k++) { await press('#pitch-dn'); await wait(350); }
  await finishLine();
}
await press('[data-sel="7"]'); await wait(300);
if (await say('locks', 'Hold a step', 'that one hit gets its own settings', 'high')) {
  await touch('.step[data-step="14"]', 600); await wait(400);
  await press('#pitch-up'); await wait(400); await press('#pitch-up'); await wait(400);
  await slide('#pad-panel [data-key="nudge"]', 30, 900);
  await wait(500); await press('#lock-done');
  await finishLine();
}
if (await say('tune', 'A bass line', 'a pitch on each step', 'high')) {
  // the bass: four notes, then the third and fourth get their own pitches
  await press('[data-sel="1"]'); await wait(500);
  for (const st of [0, 6, 8, 12]) { await touch(`.step[data-step="${st}"]`, 120); await wait(300); }
  for (const [st, ups] of [[8, 3], [12, 4]]) {
    await touch(`.step[data-step="${st}"]`, 600); await wait(300);
    for (let k = 0; k < ups; k++) { await press('#pitch-up'); await wait(300); }
    await press('#lock-done'); await wait(300);
  }
  await wait(1200);
  await finishLine();
}
await press('[data-mode="play"]'); await wait(400);
if (await say('copy', 'Eight patterns', 'tap an empty one: start fresh or copy', 'low')) {
  // an empty pattern asks: start it empty, or as a copy of this one
  await wait(600); await press('[data-pat="1"]'); await wait(1100);
  await press('[data-p="copy"]'); await wait(1000);
  await finishLine();
}
if (await say('chain', 'Chain', 'tap patterns in order, then done', 'low')) {
  await wait(300); await press('#chain'); await wait(500);
  for (const i of [0, 1, 0, 1]) { await press(`[data-pat="${i}"]`); await wait(300); }
  await press('#chain');
  await finishLine();
}
if (await say('knobs', 'The knobs', 'filter · drive · crush · swing · LFO', 'high')) {
  await slide('#fx-panel [data-key="filter"]', -60, 1400);
  await slide('#fx-panel [data-key="filter"]', 0, 700);
  await slide('#fx-panel [data-key="crush"]', 55, 1100);
  await slide('#fx-panel [data-key="crush"]', 0, 500);
  await slide('#f-swing', 45, 900);
  await slide('#fx-panel [data-key="lfo"]', 60, 900);
  await finishLine();
  await slide('#fx-panel [data-key="lfo"]', 0, 400); await slide('#f-swing', 0, 400);
}
if (await say('motion', 'Record knob moves', 'hold a knob while recording', 'high')) {
  await press('#rec'); await wait(300);
  await slide('#fx-panel [data-key="filter"]', -80, 2400);
  await press('#rec'); await wait(2400);
  await finishLine();
}
await press('#play'); await wait(300);
if (await say('export', 'Save it', 'the whole song · a loop · MIDI · every sound · Boba', '')) {
  await wait(500); await press('#menu'); await wait(Math.max(1200, clips.export.seconds * 1000 - 1500));
  await closeMenu();
  await finishLine();
}
await cap('');
await page.evaluate(() => { const d = document.createElement('div'); d.id = 'tt-end'; d.innerHTML = '<div>Pop Pads<small>now make it pop ✦</small></div>'; document.body.appendChild(d); });
await say('bye', '');
await finishLine();
await wait(900);

// ---------- finish: join picture and sound ----------
const audioB64 = await page.evaluate(() => window.__stopAudio());
const total = (Date.now() - t0) / 1000;
await page.close();
await cdp.send('Page.stopScreencast').catch(() => {});
const list = ['ffconcat version 1.0'];
frames.forEach((f, i) => {
  const next = frames[i + 1] ? frames[i + 1].t : Date.now();
  list.push(`file '${f.file}'`, `duration ${Math.max(0.001, (next - f.t) / 1000).toFixed(4)}`);
});
list.push(`file '${frames[frames.length - 1].file}'`);
const concat = path.join(work, 'frames.txt');
fs.writeFileSync(concat, list.join('\n'));
const firstFrame = frames[0].t;
await context.close(); await browser.close(); server.close();
const audioFile = path.join(work, 'audio.webm');
fs.writeFileSync(audioFile, Buffer.from(audioB64, 'base64'));
const offset = (audioStart - firstFrame) / 1000;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const TRIM = 0.8;
const delayMs = Math.round((offset - TRIM) * 1000);
const voiceArgs = [], voiceMix = [];
spoken.forEach((sp, i) => {
  voiceArgs.push('-i', clips[sp.key].file);
  voiceMix.push(`[${i + 2}:a]aresample=48000,adelay=${Math.round(sp.at * 1000) + delayMs}:all=1,volume=1.6[v${i}]`);
});
const graph = [
  `[1:a]aresample=48000,adelay=${delayMs}:all=1,loudnorm=I=-20:TP=-2[music]`,
  ...voiceMix,
  `${spoken.map((_, i) => `[v${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0,apad,asplit=2[voice][voiceSc]`,
  '[music][voiceSc]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=350[ducked]',
  '[ducked][voice]amix=inputs=2:normalize=0,alimiter=limit=0.89,loudnorm=I=-16:TP=-1.5[a]',
].join(';');
execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
  '-ss', String(TRIM), '-f', 'concat', '-safe', '0', '-i', concat, '-i', audioFile, ...voiceArgs,
  '-filter_complex', graph, '-map', '0:v', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
  '-vf', 'scale=720:1280:flags=lanczos', '-c:a', 'aac', '-b:a', '128k', '-shortest', OUT], { stdio: 'inherit' });
console.log(`tutorial: ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB, ${total.toFixed(0)} s, ${frames.length} frames)`);
fs.rmSync(work, { recursive: true, force: true });
