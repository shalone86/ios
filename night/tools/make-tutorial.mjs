// Films the Deep Drift tutorial: drives the real app at phone size, with
// captions, a spoken line for each step and a dot where each finger lands.
// It records the screen and the app's own sound, lays the voice over it
// (the sea dips under the voice) and writes web/media/tutorial.mp4.
//
// The voice comes from the Aura-2 text-to-speech behind the readaloud Worker.
// Clips are kept in tools/tutorial-voice/, so re-filming needs no network
// unless a line changes.
//
//   node night/tools/make-tutorial.mjs
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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-tour-'));
const require = createRequire(import.meta.url);
let pw;
for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }

// ---------- narration ----------
const VOICE = 'luna';
const TTS = 'https://readaloud.ariyandhamma.workers.dev/api/tts';
const LINES = {
  intro: 'This is Deep Drift. A dark, quiet sea that sings you to sleep.',
  tap: 'Tap a sleepy jellyfish. Its note drifts away, and comes back, again and again.',
  weave: 'Each one has its own loop, so the notes slowly weave together.',
  hold: 'Hold one to hum its note, for as long as you like.',
  voices: 'Pick a voice. Pad, Glass, Choir, or Low. Notes you played before keep their own sound.',
  depth: 'Depth sinks everything lower, darker, and farther away.',
  tide: 'Tide sets how long the echoes keep coming back.',
  tape: 'Tape adds the wobble, warmth, and hiss of an old cassette.',
  animate: 'Or press Animate, and the tide moves on its own.',
  hum: 'Hum adds a low drone underneath.',
  mood: 'Change the mood up here. Every note still fits.',
  sleep: 'Set the sleep timer, and the sea fades away when it\'s time.',
  bye: 'Tap a few lights, then close your eyes. Goodnight.',
};
const VOICE_DIR = path.join(here, 'tutorial-voice');
fs.mkdirSync(VOICE_DIR, { recursive: true });
const OWN_DIR = path.join(VOICE_DIR, 'own');
const clips = {};
for (const [key, text] of Object.entries(LINES)) {
  // your own recording wins: tools/tutorial-voice/own/<key>.wav (or .m4a, .mp3, …)
  const own = fs.existsSync(OWN_DIR) && fs.readdirSync(OWN_DIR).find((f) => path.parse(f).name === key);
  const name = own ? `own-${key}.mp3` : `${VOICE}-${key}-${Buffer.from(text).toString('base64url').slice(0, 10)}.mp3`;
  const file = path.join(own ? work : VOICE_DIR, name);
  if (own) {
    // trim the silence at each end, keep it mono and even in level
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', path.join(OWN_DIR, own), '-af',
      'highpass=f=70,silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.12,areverse,silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.25,areverse,afade=t=in:d=0.05,loudnorm=I=-18:TP=-2',
      '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', file]);
  } else if (!fs.existsSync(file)) {
    for (const old of fs.readdirSync(VOICE_DIR)) if (old.startsWith(`${VOICE}-${key}-`)) fs.rmSync(path.join(VOICE_DIR, old));
    const res = await fetch(`${TTS}?voice=${VOICE}&text=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`voice for "${key}" failed: ${res.status}`);
    const wav = path.join(work, `${key}.wav`);
    fs.writeFileSync(wav, Buffer.from(await res.arrayBuffer()));
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', file]);
  }
  const secs = parseFloat(String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])));
  clips[key] = { file, seconds: secs };
}
console.log(`narration: ${Object.keys(clips).length} lines, ${Object.values(clips).reduce((a, c) => a + c.seconds, 0).toFixed(0)} s`);

// ---------- a tiny static server for web/ ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
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
await context.addInitScript(() => { try { localStorage.setItem('deepdrift.seenTour', '1'); } catch (e) { /* fine */ } });
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
  #toast, #tour-link, #apk { display: none !important; }
  #tt-cap { position: fixed; left: 16px; right: 16px; top: 74px; z-index: 99; text-align: center; pointer-events: none;
    font: 600 19px Fredoka, sans-serif; color: #e4f0ff; line-height: 1.25; padding: 12px 16px; border-radius: 20px;
    background: rgba(8, 18, 48, 0.86); border: 1px solid rgba(160, 205, 255, .25); box-shadow: 0 0 30px rgba(90, 160, 255, .2);
    transition: opacity .4s, transform .4s; }
  #tt-cap.off { opacity: 0; transform: translateY(-8px); }
  #tt-cap small { display: block; font-weight: 400; font-size: 14px; opacity: .8; margin-top: 3px; }
  .tt-dot { position: fixed; z-index: 98; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none;
    background: rgba(200, 230, 255, .3); border: 2px solid rgba(220, 240, 255, .9); box-shadow: 0 0 18px rgba(160, 210, 255, .7); transition: opacity .4s, transform .4s; }
  .tt-dot.up { opacity: 0; transform: scale(1.5); }
  #tt-end { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; text-align: center; color: #dcecff;
    background: radial-gradient(circle at 50% 30%, #12285a, #030716 70%); font: 600 42px Fredoka, sans-serif; opacity: 0; transition: opacity 1.5s; }
  #tt-end.on { opacity: 1; }
  #tt-end small { display: block; font-size: 18px; font-weight: 400; margin-top: 10px; opacity: .8; }
` });
await page.evaluate(() => {
  const c = document.createElement('div'); c.id = 'tt-cap'; c.className = 'off'; document.body.appendChild(c);
  window.__dot = { down(x, y) { const d = document.createElement('div'); d.className = 'tt-dot'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); return d; },
    move(d, x, y) { d.style.left = x + 'px'; d.style.top = y + 'px'; }, up(d) { d.classList.add('up'); setTimeout(() => d.remove(), 450); } };
  // touch a jellyfish on the sea, for `hold` ms
  window.__orb = async (i, hold) => {
    const o = window.deepDrift.orbs[i], el = document.getElementById('sea'), x = o.sx, y = o.sy;
    const id = 100 + Math.floor(Math.random() * 1e6);
    const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const dot = window.__dot.down(x, y);
    fire('pointerdown');
    await new Promise((r) => setTimeout(r, hold));
    fire('pointerup'); window.__dot.up(dot);
  };
  // tap a button
  window.__press = async (sel) => {
    const el = document.querySelector(sel), b = el.getBoundingClientRect();
    const dot = window.__dot.down(b.left + b.width / 2, b.top + b.height / 2);
    await new Promise((r) => setTimeout(r, 160));
    el.click(); window.__dot.up(dot);
  };
  // drag a slider's thumb to a new value over `ms`
  window.__slide = async (id, to, ms) => {
    const el = document.getElementById(id), b = el.getBoundingClientRect(), from = +el.value;
    const xOf = (v) => b.left + 10 + (b.width - 20) * v / 100, y = b.top + b.height / 2;
    const dot = window.__dot.down(xOf(from), y), t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.value = Math.round(from + (to - from) * e);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      window.__dot.move(dot, xOf(+el.value), y);
      if (k >= 1) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    window.__dot.up(dot);
  };
});
const cap = (text, sub = '') => page.evaluate(([t, s]) => {
  const c = document.getElementById('tt-cap');
  c.innerHTML = t ? `${t}${s ? `<small>${s}</small>` : ''}` : '';
  c.className = t ? '' : 'off';
}, [text, sub]);
const spoken = [];
let sayEnd = 0, audioT0 = 0;
async function say(key, text, sub = '') {
  const now = Date.now();
  if (sayEnd > now) await wait(sayEnd - now + 500);       // unhurried: a breath between lines
  const at = Date.now();
  spoken.push({ key, at: (at - audioT0) / 1000 });
  sayEnd = at + clips[key].seconds * 1000;
  await cap(text, sub);
}
const finishLine = async () => { const left = sayEnd - Date.now(); if (left > 0) await wait(left + 300); };
const orb = (i, hold = 150) => page.evaluate(([n, h]) => window.__orb(n, h), [i, hold]);
const press = (sel) => page.evaluate((s) => window.__press(s), sel);
const slide = (id, to, ms = 1800) => page.evaluate(([a, b, c]) => window.__slide(a, b, c), [id, to, ms]);

// ================= the tutorial =================
const t0 = Date.now();
await wait(1500);
await press('#go');
await page.waitForFunction(() => window.deepDrift.drift && window.deepDrift.drift.ctx.state === 'running');
// record the app's own sound
const audioStart = await page.evaluate(() => {
  const d = window.deepDrift.drift, dest = d.ctx.createMediaStreamDestination();
  d.out.connect(dest);
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
audioT0 = audioStart;
await wait(900);
await say('intro', 'Deep Drift', 'a dark, quiet sea that sings you to sleep');
await finishLine();

await say('tap', 'Tap a sleepy jellyfish', 'its note drifts away and comes back');
await wait(1200);
await orb(3);
await finishLine();
await say('weave', 'Each one has its own loop', 'so the notes slowly weave together');
await wait(600); await orb(7); await wait(1800); await orb(5);
await finishLine(); await wait(800);

await say('hold', 'Hold one to hum', 'for as long as you like');
await wait(800); await orb(9, 4200);
await finishLine();

await say('voices', 'Pick a voice', 'Pad, Glass, Choir or Low');
await wait(1400); await press('[data-voice="glass"]'); await wait(500); await orb(10);
await wait(1800); await press('[data-voice="choir"]'); await wait(500); await orb(6);
await finishLine(); await wait(800);

await say('depth', 'Depth', 'lower, darker, farther away');
await slide('depth', 85, 2600);
await finishLine();
await say('tide', 'Tide', 'how long the echoes keep coming back');
await slide('tide', 80, 2000);
await finishLine();
await say('tape', 'Tape', 'the wobble, warmth and hiss of an old cassette');
await slide('tape', 70, 2200); await orb(4);
await finishLine(); await wait(800);

await say('animate', '✦ Animate', 'the tide moves on its own');
await wait(900); await press('#animate');
await wait(1500);
await finishLine();
await say('hum', 'Hum', 'a low drone underneath');
await wait(600); await press('#hum');
await finishLine(); await wait(1200);

await say('mood', 'Moods', 'every note still fits');
await wait(1000); await press('#mood'); await wait(1200); await orb(2); await wait(900); await orb(8);
await finishLine(); await wait(600);

await say('sleep', 'Sleep timer', 'the sea fades away when it\'s time');
await wait(1100); await press('#timer');
await finishLine(); await wait(1500);
await cap('');
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'tt-end';
  d.innerHTML = '<div>Deep Drift<small>goodnight ✦</small></div>';
  document.body.appendChild(d); requestAnimationFrame(() => d.classList.add('on'));
});
await say('bye', '');
await finishLine();
await wait(2500);

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
  voiceMix.push(`[${i + 2}:a]aresample=48000,adelay=${Math.round(sp.at * 1000) + delayMs}:all=1,volume=1.5[v${i}]`);
});
const graph = [
  `[1:a]aresample=48000,adelay=${delayMs}:all=1,loudnorm=I=-22:TP=-3[music]`,
  ...voiceMix,
  `${spoken.map((_, i) => `[v${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0,apad,asplit=2[voice][voiceSc]`,
  '[music][voiceSc]sidechaincompress=threshold=0.02:ratio=4:attack=40:release=600[ducked]',
  '[ducked][voice]amix=inputs=2:normalize=0,alimiter=limit=0.89,loudnorm=I=-18:TP=-1.5[a]',
].join(';');
execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
  '-ss', String(TRIM), '-f', 'concat', '-safe', '0', '-i', concat, '-i', audioFile, ...voiceArgs,
  '-filter_complex', graph,
  '-map', '0:v', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
  '-vf', 'scale=720:1280:flags=lanczos',
  '-c:a', 'aac', '-b:a', '128k',
  '-shortest', OUT], { stdio: 'inherit' });
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`tutorial: ${OUT} (${mb} MB, ${total.toFixed(0)} s, audio offset ${offset.toFixed(2)} s, ${frames.length} frames)`);
fs.rmSync(work, { recursive: true, force: true });
