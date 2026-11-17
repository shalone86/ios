// Pop Pads: every kit renders, pads play, steps toggle, the sequencer plays
// and records, hold repeats, stutter and jumble change what plays, patterns
// chain, and the WAV, MIDI and stems exports are valid files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url)), WEB = path.resolve(here, '../web');
const OUT = fs.mkdtempSync(path.join(process.env.POP_TEST_OUT || os.tmpdir(), 'pop-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => {
  let r = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (r.endsWith('/')) r += 'index.html';
  const f = path.join(WEB, r); if (!f.startsWith(WEB) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0; const check = (ok, m) => { console.log((ok ? '  ok   ' : '  FAIL ') + m); if (!ok) failed++; };
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);

// every kit: sixteen pads with sound, nothing broken
const kits = await page.evaluate(async () => {
  const { KITS, KIT_ORDER, renderKit } = await import('/js/kits.js');
  const out = [];
  for (const id of KIT_ORDER) {
    const bufs = await renderKit(id, 44100);
    const silent = bufs.filter((b) => { let pk = 0; for (const x of b.getChannelData(0)) if (Number.isFinite(x)) pk = Math.max(pk, Math.abs(x)); return pk < 0.1; }).length;
    out.push({ id, pads: bufs.length, silent, names: KITS[id].pads.length });
  }
  return out;
});
check(kits.length === 7 && kits.every((k) => k.pads === 16 && k.silent === 0), `7 flavors, 16 pads each, all with sound (${kits.map((k) => k.id).join(', ')})`);

await page.click('#go');
await page.waitForFunction(() => window.popPads.eng && window.popPads.eng.bufs);
const pads = await page.$$('.pad');
check(pads.length === 16, 'sixteen pads on screen');
await page.screenshot({ path: path.join(OUT, 'play.png') });

// count what the engine plays, by wrapping its hit()
await page.evaluate(() => {
  const e = window.popPads.eng; window.__hits = [];
  const orig = e.hit.bind(e); e.hit = (i, t, q) => { window.__hits.push({ i, t: t ?? e.ctx.currentTime, seq: !!q }); return orig(i, t, q); };
});
const touch = (sel, type, id, dy = 0) => page.evaluate(([s, ty, pid, d]) => {
  const el = document.querySelector(s), b = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(ty, { pointerId: pid, pointerType: 'touch', isPrimary: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 - d, bubbles: true, cancelable: true }));
}, [sel, type, id, dy]);

// a tap plays once
await touch('.pad[data-pad="0"]', 'pointerdown', 1); await page.waitForTimeout(60); await touch('.pad[data-pad="0"]', 'pointerup', 1);
await page.waitForTimeout(200);
check((await page.evaluate(() => window.__hits.length)) === 1, 'a tap plays the pad once');

// holding repeats in time
await page.evaluate(() => { window.__hits = []; });
await touch('.pad[data-pad="4"]', 'pointerdown', 2); await page.waitForTimeout(1300);
const reps = await page.evaluate(() => window.__hits.filter((h) => h.i === 4).map((h) => h.t));
await touch('.pad[data-pad="4"]', 'pointerup', 2);
const gaps = reps.slice(1).map((t, k) => t - reps[k]).slice(1);
const sd = 60 / 92 / 4;
check(reps.length >= 5 && gaps.every((g) => Math.abs(g - sd) < 0.004), `holding a pad repeats it on every 16th (${reps.length} hits, gaps ${gaps.map((g) => g.toFixed(3)).join(' ')})`);

// the demo beat plays, and the playhead moves
await page.evaluate(() => { window.__hits = []; });
await page.click('#play'); await page.waitForTimeout(2700);
const bar = await page.evaluate(() => window.__hits.filter((h) => h.seq));
const kicksInBar = bar.filter((h) => h.i === 0).length, snares = bar.filter((h) => h.i === 2).length;
check(kicksInBar >= 3 && snares >= 2, `play runs pattern 1 (${bar.length} hits: ${kicksInBar} kicks, ${snares} snares in ~1 bar)`);

// stutter and jumble belong to the held pad: up = rolls on it, down = it jumbles; works stopped too
await page.click('#play'); await page.waitForTimeout(200);    // stopped
const hitsOf = (pad, ms) => page.evaluate(async ([p, wait]) => { window.__hits = []; await new Promise((r) => setTimeout(r, wait)); return window.__hits.filter((h) => h.i === p); }, [pad, ms]);
await touch('.pad[data-pad="10"]', 'pointerdown', 3); await page.waitForTimeout(300);
const plain = await hitsOf(10, 1000);
await touch('.pad[data-pad="10"]', 'pointermove', 3, 160);
const rolls = await hitsOf(10, 1000);
const shakeOne = await page.evaluate(() => [...document.querySelectorAll('.pad.stutter')].map((p) => p.dataset.pad).join());
await touch('.pad[data-pad="10"]', 'pointermove', 3, -160);
const jumbled = await hitsOf(10, 1600);
const dizzyOne = await page.evaluate(() => [...document.querySelectorAll('.pad.jumble')].map((p) => p.dataset.pad).join());
await touch('.pad[data-pad="10"]', 'pointerup', 3); await page.waitForTimeout(150);
const afterFaces = await page.evaluate(() => document.querySelectorAll('.pad.stutter,.pad.jumble').length + window.popPads.eng.held.size);
const others = await page.evaluate(() => window.__hits.filter((h) => h.i !== 10).length);
const steps16 = 1000 / (60000 / 92 / 4);
check(rolls.length >= plain.length * 3 && Math.abs(plain.length - steps16) <= 2 && shakeOne === '10', `holding repeats a pad (${plain.length} hits a second); sliding up rolls it (${rolls.length}), only that pad shakes, even when stopped`);
const pitched = await page.evaluate(() => window.__hits.length);
check(jumbled.length > 3 && dizzyOne === '10' && others === 0, `sliding down jumbles just that pad (${jumbled.length} hits, no other drum touched)`);
check(afterFaces === 0, 'letting go stops it and the faces settle');
await page.click('#play');

// recording a tap while playing writes it onto the nearest step
await page.evaluate(() => { window.popPads.song.patterns[0][7] = 0; });
await page.click('#rec'); await page.waitForTimeout(150);
await touch('.pad[data-pad="7"]', 'pointerdown', 4); await page.waitForTimeout(40); await touch('.pad[data-pad="7"]', 'pointerup', 4);
await page.waitForTimeout(200); await page.click('#rec');
const recorded = await page.evaluate(() => window.popPads.song.patterns[0][7]);
check(recorded && (recorded & (recorded - 1)) === 0, `a tap while recording lands on one step (pattern bits ${recorded.toString(2)})`);
await page.click('#play');

// steps mode: tap steps for one sound
await page.click('[data-mode="steps"]'); await page.waitForTimeout(100);
await page.click('[data-sel="3"]');
for (const s of [4, 12]) { await touch(`.step[data-step="${s}"]`, 'pointerdown', 10 + s); await touch(`.step[data-step="${s}"]`, 'pointerup', 10 + s); }
const clap = await page.evaluate(() => window.popPads.song.patterns[0][3]);
check(clap === ((1 << 4) | (1 << 12)), `steps mode writes the clap on steps 5 and 13 (bits ${clap.toString(2)})`);
await page.screenshot({ path: path.join(OUT, 'steps.png') });
await page.click('[data-mode="play"]');

// patterns: tap an empty one → start empty or copy; hold one → copy here / clear; ↶ undoes
await page.evaluate(() => { const s = window.popPads.song; s.patterns[1] = new Array(16).fill(0); s.patterns[2] = new Array(16).fill(0); });
await page.click('[data-pat="1"]'); await page.waitForTimeout(300);
const askEmpty = await page.evaluate(() => [...document.querySelectorAll('#sheet [data-p]')].map((b) => b.dataset.p).join());
await page.click('[data-p="copy"]'); await page.waitForTimeout(300);
const copied = await page.evaluate(() => JSON.stringify(window.popPads.song.patterns[1]) === JSON.stringify(window.popPads.song.patterns[0]) && window.popPads.song.cur === 1);
check(askEmpty === 'empty,copy' && copied, 'tapping an empty pattern offers to start empty or copy the one you were on; copy works');
await page.evaluate(() => { const b = document.querySelector('[data-pat="2"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
await page.waitForTimeout(650);
const holdMenu = await page.evaluate(() => [...document.querySelectorAll('#sheet [data-p]')].map((b) => b.dataset.p).join());
await page.evaluate(() => { const b = document.querySelector('[data-pat="2"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
await page.click('[data-p="copy"]'); await page.waitForTimeout(800);
const two = await page.evaluate(() => window.popPads.song.patterns[2].some(Boolean));
await page.click('#undo'); await page.waitForTimeout(300);
const undone = await page.evaluate(() => !window.popPads.song.patterns[2].some(Boolean));
// hold → clear, then undo brings it back
await page.evaluate(() => { const b = document.querySelector('[data-pat="1"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
await page.waitForTimeout(650);
await page.evaluate(() => { const b = document.querySelector('[data-pat="1"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
await page.click('[data-p="clear"]'); await page.waitForTimeout(800);
const cleared = await page.evaluate(() => !window.popPads.song.patterns[1].some(Boolean));
await page.click('#undo'); await page.waitForTimeout(300);
const back = await page.evaluate(() => window.popPads.song.patterns[1].some(Boolean));
check(holdMenu === 'copy,go' && two && undone && cleared && back, `holding a pattern offers copy here (${holdMenu}); clear; ↶ undoes each`);
await page.click('#chain'); for (const i of [0, 1, 0]) await page.click(`[data-pat="${i}"]`); await page.click('#chain');
const chain = await page.evaluate(() => window.popPads.song.chain.join(','));
check(chain === '0,1,0', `patterns chain (${chain})`);

// record from a stop: a bar of clicks (count-in) before the pattern starts
const countIn = await page.evaluate(async () => {
  const e = window.popPads.eng, g = e.graph, clicks = [], seen = [];
  const oc = g.click.bind(g); g.click = (t, a) => { clicks.push({ t, a }); return oc(t, a); };
  const ocount = e.onCount; e.onCount = (b) => { seen.push(b); ocount(b); };
  window.__hits = [];
  const t0 = e.ctx.currentTime;
  document.getElementById('rec').click();
  await new Promise((r) => setTimeout(r, 3600));
  const firstHit = window.__hits.find((h) => h.seq);
  document.getElementById('rec').click(); document.getElementById('play').click();
  g.click = oc; e.onCount = ocount;
  return { clicks: clicks.filter((c) => c.t < (firstHit ? firstHit.t : 99)).length, accent: clicks[0] && clicks[0].a, firstAfter: firstHit ? firstHit.t - t0 : null, seen };
});
const barSec = 4 * 60 / 92;
check(countIn.clicks === 4 && countIn.accent && countIn.firstAfter > barSec && countIn.firstAfter < barSec + 0.3 && countIn.seen.join() === '1,2,3,4,0',
  `record from a stop counts in one bar: 4 clicks, then the pattern (${countIn.firstAfter && countIn.firstAfter.toFixed(2)} s later; beats shown ${countIn.seen.join(',')})`);
// the metronome clicks on every beat while playing
const metro = await page.evaluate(async () => {
  const e = window.popPads.eng, g = e.graph, clicks = [];
  const oc = g.click.bind(g); g.click = (t, a) => { clicks.push(a); return oc(t, a); };
  document.getElementById('metro').click(); document.getElementById('play').click();
  await new Promise((r) => setTimeout(r, 2700));
  document.getElementById('play').click(); document.getElementById('metro').click(); g.click = oc;
  return clicks;
});
check(metro.length >= 4 && metro[0] === true && metro.filter(Boolean).length >= 1, `the metronome clicks each beat, louder on one (${metro.length} clicks)`);

// knobs reach the sound
const MIXF = '#fx-panel [data-key="filter"]';
await page.fill(MIXF, '-70'); await page.dispatchEvent(MIXF, 'input');
const lp = await page.evaluate(() => new Promise((r) => setTimeout(() => r(window.popPads.eng.graph.lp.frequency.value), 300)));
check(lp < 2000, `the filter knob closes the low-pass (${Math.round(lp)} Hz)`);
await page.fill(MIXF, '0'); await page.dispatchEvent(MIXF, 'input');

// Steps mode: a Drum tab and a Mix tab
await page.click('[data-mode="steps"]'); await page.click('[data-sel="0"]');
const drumTab = await page.evaluate(() => ({ pad: !document.getElementById('pad-panel').hidden, mix: !document.getElementById('fx-panel').hidden, keys: [...document.querySelectorAll('#pad-panel [data-key]')].map((x) => x.dataset.key).join() }));
await page.click('[data-tab="mix"]');
const mixTab = await page.evaluate(() => !document.getElementById('fx-panel').hidden && document.getElementById('pad-panel').hidden);
await page.click('[data-tab="drum"]');
check(drumTab.pad && !drumTab.mix && mixTab && drumTab.keys === 'pitch,len,filt,vol,crush,lfo,nudge', `Steps has a Drum tab (${drumTab.keys}) and a Mix tab`);

// hold a step: that hit gets its own pitch and nudge; the rest keep the drum's
await page.evaluate(() => { const s = window.popPads.song; s.patterns[s.cur][0] = 1 | (1 << 8); s.motion[s.cur] = { mix: {}, pads: {} }; });
await page.click('[data-mode="play"]'); await page.click('[data-mode="steps"]');
await touch('.step[data-step="8"]', 'pointerdown', 40); await page.waitForTimeout(500); await touch('.step[data-step="8"]', 'pointerup', 40);
const sel8 = await page.evaluate(() => !!document.querySelector('.step[data-step="8"].sel') && document.getElementById('panel').classList.contains('locked'));
const P = '#pad-panel [data-key="pitch"]', NUD = '#pad-panel [data-key="nudge"]';
await page.fill(P, '7'); await page.dispatchEvent(P, 'input'); await page.dispatchEvent(P, 'change');
await page.fill(NUD, '30'); await page.dispatchEvent(NUD, 'input');
await page.click('#lock-done');
const locks = await page.evaluate(async () => {
  const { padAt } = await import('/js/engine.js');
  const s = window.popPads.song;
  return { on8: padAt(s, s.cur, 0, 8), on0: padAt(s, s.cur, 0, 0), dot: !!document.querySelector('.step[data-step="8"].lock'), sel: document.querySelectorAll('.step.sel').length };
});
check(sel8 && locks.on8.pitch === 7 && Math.abs(locks.on8.nudge - 0.3) < 0.01 && locks.on0.pitch === 0 && locks.dot && locks.sel === 0,
  `holding a step gives that hit its own pitch (+${locks.on8.pitch}) and nudge (${locks.on8.nudge}); the others keep theirs; the step shows a dot`);
// a nudged hit really plays late
const nudged = await page.evaluate(async () => {
  const e = window.popPads.eng, hits = []; const oh = e.hit.bind(e);
  e.hit = (i, t, q, tw) => { if (q && i === 0) hits.push(t - e.timeOf(Math.round((t - e.t0) / (60 / e.song.bpm / 4)))); return oh(i, t, q, tw); };
  e.play(); await new Promise((r) => setTimeout(r, 2800)); e.stop(); e.hit = oh;
  return hits;
});
const sd92 = 60 / 92 / 4;
check(nudged.some((d) => Math.abs(d - 0.3 * sd92) < 0.01 || Math.abs(d + 0.7 * sd92) < 0.01), `the nudged step plays ${Math.round(0.3 * sd92 * 1000)} ms late`);
await page.click('[data-mode="play"]');

// record knob moves: hold the mix filter and move it while recording
await page.evaluate(() => { const s = window.popPads.song; s.motion[s.cur] = { mix: {}, pads: {} }; });
const motion = await page.evaluate(async () => {
  const e = window.popPads.eng, el = document.querySelector('#fx-panel [data-key="filter"]'), s = window.popPads.song;
  document.getElementById('play').click(); await new Promise((r) => setTimeout(r, 200));
  e.rec = true;
  for (let k = 0; k < 14; k++) { el.value = String(-90 + k * 6); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 120)); }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  e.rec = false;
  const lane = s.motion[s.cur].mix.filter || [];
  const base = s.fx.filter;
  // playing back: the low-pass follows the recording
  const seen = new Set();
  for (let k = 0; k < 20; k++) { await new Promise((r) => setTimeout(r, 90)); seen.add(Math.round(e.graph.lp.frequency.value / 100)); }
  document.getElementById('play').click();
  return { written: lane.filter((v) => v != null).length, base, moves: seen.size, diamond: document.querySelector('#fx-panel [data-key="filter"]').closest('.sl').classList.contains('moving') };
});
check(motion.written >= 6 && motion.base === 0 && motion.moves >= 3 && motion.diamond, `moving a knob while recording writes ${motion.written} steps of motion (knob's own setting untouched), and it plays back (${motion.moves} filter positions seen) ◆`);
const rendered = await page.evaluate(async () => {
  const { renderSong } = await import('/js/engine.js');
  const s = JSON.parse(JSON.stringify(window.popPads.song)); s.chain = [s.cur];
  const a = await renderSong(s, { loops: 1 }); s.motion[s.cur] = { mix: {}, pads: {} };
  const b = await renderSong(s, { loops: 1 });
  let d = 0; const x = a.buffer.getChannelData(0), y = b.buffer.getChannelData(0); for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return d / x.length;
});
check(rendered > 0.001, 'saved loops include the knob moves and step settings');

// repeat: ×3 on a drum plays three hits in its step
await page.click('[data-mode="steps"]'); await page.click('[data-sel="6"]');
await page.click('#p-rep'); await page.click('#p-rep');
const repLabel = await page.textContent('#p-rep');
const ratchet = await page.evaluate(async () => {
  const s = window.popPads.song, e = window.popPads.eng, keep = JSON.stringify(s.patterns[s.cur]);
  s.patterns[s.cur] = new Array(16).fill(0); s.patterns[s.cur][6] = 1;
  window.__hits = []; e.play(); await new Promise((r) => setTimeout(r, 900)); e.stop();
  s.patterns[s.cur] = JSON.parse(keep);
  const h = window.__hits.filter((x) => x.i === 6 && x.seq);
  return { n: h.length, gaps: h.slice(1).map((x, k) => +(x.t - h[k].t).toFixed(3)) };
});
check(repLabel === 'repeat ×3' && ratchet.n === 3 && ratchet.gaps.every((g) => Math.abs(g - 60 / 92 / 4 / 3) < 0.003), `repeat ×3 plays three hits in the step (${ratchet.n}, ${ratchet.gaps.join(' / ')} s apart)`);
await page.click('#p-rep'); await page.click('#p-rep');
await page.click('[data-mode="play"]');

// start fresh: clears every pattern, and ↶ brings them back
await page.click('#menu'); await page.click('[data-fresh]'); await page.click('[data-f="go"]'); await page.waitForTimeout(700);
const fresh = await page.evaluate(() => window.popPads.song.patterns.every((p) => !p.some(Boolean)) && window.popPads.song.chain.join() === '0');
await page.click('#undo'); await page.waitForTimeout(300);
const restored = await page.evaluate(() => window.popPads.song.patterns.some((p) => p.some(Boolean)));
check(fresh && restored, 'Start fresh clears every pattern, and ↶ brings them back');

// reverb: a drum room that rings after the snare, and hardly touches the kick
const verb = await page.evaluate(async () => {
  const { newSong, renderSong } = await import('/js/engine.js');
  const tail = async (pad, amount) => {
    const s = newSong(); s.patterns[0] = new Array(16).fill(0); s.patterns[0][pad] = 1; s.fx.verb = amount; s.fx.drive = 0;
    const { buffer } = await renderSong(s, { loops: 1, tail: 2 });
    const c = buffer.getChannelData(0), sr = buffer.sampleRate; let e = 0;
    for (let i = Math.round(0.7 * sr); i < Math.round(1.1 * sr); i++) e += c[i] * c[i];
    return 10 * Math.log10(e / (0.4 * sr) + 1e-12);
  };
  return { snareDry: await tail(2, 0), snareWet: await tail(2, 0.8), kickDry: await tail(0, 0), kickWet: await tail(0, 0.8) };
});
check(verb.snareWet - verb.snareDry > 15 && (verb.kickWet - verb.kickDry) < (verb.snareWet - verb.snareDry) - 10,
  `Reverb rings on after the snare (+${(verb.snareWet - verb.snareDry).toFixed(0)} dB tail) and barely touches the kick (+${(verb.kickWet - verb.kickDry).toFixed(0)} dB)`);

// menus (Boba's): tap outside to close; a short pull springs back, a long pull closes
await page.click('#bpm');
await page.click('#scrim', { position: { x: 20, y: 20 } });
const closedTap = await page.evaluate(() => document.getElementById('sheet').hidden);
await page.click('#menu');
const apk = await page.evaluate(() => !!document.querySelector('#sheet a[href="PopPads.apk"]'));
const pull = (to) => page.evaluate(async (dist) => {
  const sh = document.getElementById('sheet'), b = sh.getBoundingClientRect(), x = b.left + 60, y0 = b.top + 20;
  const t = (y) => new Touch({ identifier: 9, target: sh, clientX: x, clientY: y });
  const fire = (type, y) => sh.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t(y)], changedTouches: [t(y)], bubbles: true, cancelable: true }));
  fire('touchstart', y0); let moved = '';
  for (let y = 0; y <= dist; y += 20) { fire('touchmove', y0 + y); await new Promise((r) => setTimeout(r, 16)); moved = sh.style.transform; }
  fire('touchend', y0 + dist); await new Promise((r) => setTimeout(r, 260));
  return { moved, hidden: sh.hidden, after: sh.style.transform };
}, to);
const short = await pull(60), long = await pull(200);
check(closedTap && apk && /translateY\(6\dpx\)/.test(short.moved) && !short.hidden && short.after === '' && long.hidden,
  `menus follow the finger (${short.moved}), spring back from a short pull, close from a long one or a tap outside; ☰ links the Android app`);
await page.click('#menu'); await page.click('[data-how]'); await page.waitForTimeout(1200);
const tour = await page.evaluate(() => ({ open: !document.getElementById('tour').hidden, src: document.getElementById('tour-video').currentSrc, ready: document.getElementById('tour-video').readyState }));
await page.click('#tour-close');
const tourClosed = await page.evaluate(() => document.getElementById('tour').hidden);
check(tour.open && /tutorial\.mp4$/.test(tour.src) && tour.ready >= 1 && tourClosed, 'how it works opens the video tutorial, and ✕ closes it');

// change flavor: the beat stays, the sounds change
await page.click('#kit'); await page.click('[data-kit="cream"]'); await page.waitForTimeout(400); await page.click('#scrim', { position: { x: 20, y: 20 } });
const kitNow = await page.evaluate(() => ({ kit: window.popPads.song.kit, name: document.querySelector('.pad[data-pad="2"] b').textContent, keeps: window.popPads.song.patterns[0][0] }));
check(kitNow.kit === 'cream' && kitNow.name === 'Pssht' && kitNow.keeps, 'a new flavor swaps the sounds and keeps the beat');
await page.screenshot({ path: path.join(OUT, 'cream.png') });

// exports
await page.click('#menu');
const save = async (what) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(`[data-save="${what}"]`)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };
const wav = await save('wav');
const probe = String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,bits_per_raw_sample:format=duration', '-of', 'csv=p=0', wav])).trim().replace(/\n/g, ' ');
const lufs = String(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${wav}" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "^ +I:"`])).trim();
// chain 1,2,1 at 92 bpm, played twice: 6 bars
const want = 6 * 4 * 60 / 92;
const dur = parseFloat(probe.split(' ').pop());
check(/44100,2,24/.test(probe) && Math.abs(dur - want) < 0.02, `WAV loop: 24-bit stereo, exactly the chain twice (${dur.toFixed(2)} s of ${want.toFixed(2)}), ${lufs}`);
const mid = fs.readFileSync(await save('midi'));
const notes = [...mid].filter((b, i) => b === 0x99 && i > 22).length;
check(mid.slice(0, 4).toString() === 'MThd' && mid.slice(14, 18).toString() === 'MTrk' && notes > 20, `MIDI: a valid file with ${notes} drum hits on channel 10`);
const zip = await save('stems');
const list = String(execFileSync('unzip', ['-Z1', zip])).trim().split('\n');
check(list.some((n) => /mix\.wav$/.test(n)) && list.length >= 5, `stems: ${list.length} files (${list.map((n) => n.split('/').pop()).join(', ')})`);
await page.click('#scrim', { position: { x: 20, y: 20 } });

// the beat is still there after a reload
await page.reload();
const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('poppads.song')));

// fits the screen: small phone, a 412-wide phone with bigger text, and sideways
const fits = [];
for (const [w, h, label, zoom] of [[360, 640, 'small phone', 1], [412, 780, 'phone, larger text', 1.15], [915, 380, 'sideways', 1], [1440, 820, 'laptop', 1]]) {
  const lp2 = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
  lp2.on('pageerror', (e) => errors.push(String(e)));
  await lp2.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  if (zoom !== 1) await lp2.addStyleTag({ content: `html { font-size: ${zoom * 100}%; } .chip, #top h1, .seg button { zoom: ${zoom}; }` });
  await lp2.click('#go'); await lp2.waitForTimeout(400);
  for (const m of ['play', 'steps']) {
    await lp2.click(`[data-mode="${m}"]`); await lp2.waitForTimeout(250);
    const r = await lp2.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const W = innerWidth, H = innerHeight, menu = box('#menu'), grid = box('#grid'), panel = box('#panel'), sounds = document.getElementById('sounds');
      return { menuIn: menu.right <= W + 0.5, gridIn: grid.bottom <= H + 0.5 && grid.top >= 0, noOverlap: document.body.classList.contains('wide') || grid.bottom <= panel.top + 0.5,
        panelIn: document.body.classList.contains('wide') || panel.bottom <= H + 0.5, sounds: sounds.hidden ? null : sounds.getBoundingClientRect().height, grid: Math.round(grid.width) };
    });
    const ok = r.menuIn && r.gridIn && r.noOverlap && r.panelIn && (r.sounds === null || r.sounds >= 28) && r.grid >= 200;
    fits.push(ok); if (!ok) console.log('   ', label, m, JSON.stringify(r));
    await lp2.screenshot({ path: path.join(OUT, `fit-${w}x${h}-${m}.png`) });
  }
  await lp2.close();
}
check(fits.every(Boolean), `fits the screen on a small phone, a phone with larger text, sideways and a laptop (${fits.filter(Boolean).length}/${fits.length})`);
check(kept && kept.kit === 'cream' && kept.chain.join() === '0,1,0' && kept.patterns[0][3] === ((1 << 4) | (1 << 12)), 'the song is kept on the device');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
console.log('output in', OUT);
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all Pop Pads checks passed');
process.exit(failed ? 1 : 0);
