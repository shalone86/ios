// Cozy Chords: the chords of a key, tapping and strumming, the beat, a
// recorded take, and every save (Song, Loop, MIDI, stems, and the hand-over
// to Boba Beats, with both apps served from one site as on shalonely.com).
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
// the chords of a key
const keys = await page.evaluate(async () => {
  const { chordsOf, chordNotes, stringNotes, bassNote } = await import('/chords/js/theory.js');
  const c = chordsOf(0, 'major'), a = chordsOf(9, 'minor');
  return { cMajor: c.map((x) => x.label).join(' '), aMinor: a.map((x) => x.label).join(' '), g7: chordNotes(c[7]).join(), strings: stringNotes(c[0]).join(), bass: bassNote(c[3]) };
});
check(keys.cMajor === 'C F G Am Dm Em Fmaj7 G7 B♭ Fm D Csus2' && keys.aMinor === 'Am F C G Dm Em E7 Fmaj7 D B♭ Am7 Asus4',
  `the twelve chords of a key: C major ${keys.cMajor} · A minor ${keys.aMinor}`);
check(keys.g7 === '55,59,62,65' && keys.strings === '52,55,60,64,67,72,76,79,84,88,91,96' && keys.bass === 45, `voicings: G7 ${keys.g7}, C's strings ${keys.strings}, Am's bass ${keys.bass}`);

// tap a chord, strum the strings
await page.click('#go');
await page.waitForFunction(() => window.cozy.eng);
const box = async (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const touch = async (sel, type, x, y) => page.dispatchEvent(sel, type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true });
const am = await box('.chord[data-i="3"]');
await touch('.chord[data-i="3"]', 'pointerdown', am.x + am.w / 2, am.y + am.h / 2);
await touch('.chord[data-i="3"]', 'pointerup', am.x + am.w / 2, am.y + am.h / 2);
const sel = await page.evaluate(() => ({ idx: window.cozy.eng.idx, cur: document.querySelector('.chord.cur b').textContent, strip: document.getElementById('strip-name').textContent }));
check(sel.idx === 3 && sel.cur === 'Am' && sel.strip === 'Am', `tapping Am plays it and puts it on the strings (${sel.cur})`);
await page.evaluate(() => { const e = window.cozy.eng, o = e.string.bind(e); window.__strung = []; e.string = (m, v) => { window.__strung.push(m); o(m, v); }; });
const st = await box('#strip');
await touch('#strip', 'pointerdown', st.x + 12, st.y + st.h / 2);
for (let k = 1; k <= 10; k++) await touch('#strip', 'pointermove', st.x + 12 + (st.w - 24) * k / 10, st.y + st.h / 2);
await touch('#strip', 'pointerup', st.x + st.w - 12, st.y + st.h / 2);
const strung = await page.evaluate(() => window.__strung);
check(strung.length === 12 && strung.every((m, k) => !k || m > strung[k - 1]) && strung[0] === 52, `a swipe across the strip plays every string, low to high (${strung.join(' ')})`);

// record with no beat: the four clicks count all the way in, and the take is kept
await page.evaluate(() => { const c = window.cozy; c.S.beat = 'none'; c.S.bpm = 150; c.eng.beat = 'none'; c.eng.bpm = 150; });
const counted = [];
await page.exposeFunction('__count', (n) => counted.push(n));
await page.evaluate(() => { const e = window.cozy.eng, o = e.onCount; e.onCount = (n) => { window.__count(n); o(n); }; });
await page.click('#rec');
await page.waitForTimeout(4 * 60 / 150 * 1000 + 300);
{ const b = await box('.chord[data-i="0"]'); await touch('.chord[data-i="0"]', 'pointerdown', b.x + b.w / 2, b.y + b.h / 2); await page.waitForTimeout(200); await touch('.chord[data-i="0"]', 'pointerup', b.x + b.w / 2, b.y + b.h / 2); }
await page.waitForTimeout(600);
await page.click('#rec');
const free = await page.evaluate(() => ({ take: window.cozy.take }));
check(counted.join() === '1,2,3,4,0' && free.take && free.take.beat === 'none' && free.take.ev.some((e) => e.k === 'c' && e.ch.label === 'C'),
  `with no beat, the count-in goes 1, 2, 3, 4 and the take is kept (${counted.join(' ')}; ${free.take && free.take.bars} bars)`);

// right after recording, the take loops straight away, live, starting right where the recording ended;
// the mug whose chord is playing glows, and your own tapped chord stays on the strings
await page.waitForFunction(() => /looping/.test(document.getElementById('hint').textContent), null, { timeout: 2000 });
const looped = await page.evaluate(() => ({ on: !!window.cozy.eng.loop, gap: Math.round((window.cozy.eng.loop.t0 - window.cozy.eng.lastEnd) * 1000), btn: document.getElementById('play').textContent }));
await page.evaluate(() => window.cozy.select(5));
await page.waitForTimeout(400);
const glow = await page.evaluate(() => ({ lit: (document.querySelector('.chord.lit b') || {}).textContent, cur: window.cozy.cur, strip: document.getElementById('strip-name').textContent }));
check(looped.on && looped.gap <= 30 && looped.btn === '■' && glow.lit === 'C' && glow.cur === 5 && glow.strip === 'Em',
  `stopping a recording early, the take loops at once; its C mug glows while your own Em stays on the strings`);
// changing the sound while it loops: heard straight away, the loop carries on (no restart, no gap)
const loopBefore = await page.evaluate(() => window.cozy.eng.loop.t0);
await page.click('#voice'); await page.click('[data-v="harp"]'); await page.click('[data-v="omni"]'); await page.click('#scrim', { position: { x: 20, y: 20 } });
const loopAfter = await page.evaluate(() => ({ t0: window.cozy.eng.loop && window.cozy.eng.loop.t0, v: window.cozy.eng.loop && window.cozy.eng.loop.take.ev.find((e) => e.k === 'c').v }));
check(loopAfter.t0 === loopBefore && loopAfter.v === 'omni', 'changing the sound while the take loops is heard at once: the loop carries on, no restart, no gap');
await page.click('#play');
const after = await page.evaluate(() => ({ btn: document.getElementById('play').textContent, hint: document.getElementById('hint').textContent }));
const t0 = Date.now(); await page.click('#play');
await page.waitForFunction(() => /looping/.test(document.getElementById('hint').textContent));
const startMs = Date.now() - t0;
await page.click('#play');
check(after.btn === '▶' && /▶ to hear it/.test(after.hint) && startMs < 400, `■ stops it; ▶ starts it again at once (${startMs} ms)`);

// a new key: you hear its scale, and the whole take moves into it (each mug's chord, now in D minor)
await page.click('#key'); await page.click('[data-key="2"]'); await page.click('[data-mode="minor"]'); await page.click('#scrim', { position: { x: 20, y: 20 } });
const moved = await page.evaluate(() => { const t = window.cozy.take, c = t.ev.find((e) => e.k === 'c'); return { key: t.key, mode: t.mode, label: c.ch.label, n: c.n.join() }; });
check(moved.key === 2 && moved.mode === 'minor' && moved.label === 'Dm' && moved.n === '62,65,69', `changing the key moves the take: its C is now ${moved.label} (${moved.n}) in D minor`);
await page.click('#key'); await page.click('[data-key="0"]'); await page.click('[data-mode="major"]'); await page.click('#scrim', { position: { x: 20, y: 20 } });

// record a take with the beat: a bar of clicks, then two chords
await page.evaluate(() => { const c = window.cozy; c.S.beat = 'cozy'; c.S.bpm = 150; c.eng.beat = 'cozy'; c.eng.bpm = 150; });
await page.click('#rec');
const asked = await page.evaluate(() => [...document.querySelectorAll('#sheet [data-r]')].map((b) => b.dataset.r).join());
await page.click('[data-r="over"]');
const bar = 4 * 60 / 150;
await page.waitForTimeout(bar * 1000 + 250);
const tap = async (i) => { const b = await box(`.chord[data-i="${i}"]`); await touch(`.chord[data-i="${i}"]`, 'pointerdown', b.x + b.w / 2, b.y + b.h / 2); await page.waitForTimeout(250); await touch(`.chord[data-i="${i}"]`, 'pointerup', b.x + b.w / 2, b.y + b.h / 2); };
await tap(0); await page.waitForTimeout(bar * 1000 - 250); await tap(1);
// a 4-bar take stops by itself at the end of bar 4
await page.waitForFunction(() => !window.cozy.eng.rec, null, { timeout: (bar * 4 + 2) * 1000 });
let take = await page.evaluate(() => window.cozy.take);
const chordsIn = take ? take.ev.filter((e) => e.k === 'c' && !e.carried).map((e) => e.ch.label) : [];
const handover = await page.evaluate(() => ({ on: !!window.cozy.eng.loop, gap: window.cozy.eng.loop ? Math.round((window.cozy.eng.loop.t0 - window.cozy.eng.lastEnd) * 1000) : null }));
check(handover.on && handover.gap === 0, `a take that ends by itself loops from that exact moment, seamlessly (${handover.gap} ms)`);
check(asked === 'dub,over', `with a take already there, ● asks: dub on top, or record over (${asked})`);
check(!!take && take.bars === 4 && Math.abs(take.dur - 4 * bar) < 0.01 && chordsIn.join() === 'C,F' && take.beat === 'cozy', `a 4-bar take records and stops by itself: ${take && take.bars} bars, ${take && take.dur} s, chords ${chordsIn.join(' → ')}, with the beat`);
await page.click('#play');   // stop the loop that started by itself

// dub on top: the take plays, strings added over it, chords kept; same length
await page.evaluate(() => { window.cozy.S.beat = 'none'; window.cozy.eng.beat = 'none'; });
await page.click('#rec');
await page.click('[data-r="dub"]');
await page.waitForFunction(() => { const e = window.cozy.eng; return e.rec && e.ctx.currentTime > e.rec.start + 0.2; }, null, { timeout: 15000 });
const dubInfo = await page.evaluate(() => ({ bpm: window.cozy.eng.bpm, beat: window.cozy.eng.beat, bars: window.cozy.eng.rec && window.cozy.eng.rec.bars }));
const sb = await box('#strip');
for (let k = 0; k < 4; k++) { await touch('#strip', 'pointerdown', sb.x + 20 + k * 40, sb.y + sb.h / 2); await touch('#strip', 'pointerup', sb.x + 20 + k * 40, sb.y + sb.h / 2); await page.waitForTimeout(150); }
await page.waitForFunction(() => !window.cozy.eng.rec, null, { timeout: (bar * 4 + 2) * 1000 });
const dubbed = await page.evaluate(() => window.cozy.take);
const kinds = (t) => t.ev.reduce((o, e) => ((o[e.k] = (o[e.k] || 0) + 1), o), {});
check(dubInfo.beat === 'cozy' && dubInfo.bpm === 150 && dubInfo.bars === 4 && dubbed.bars === 4 && dubbed.beat === 'cozy' && kinds(dubbed).s === (kinds(take).s || 0) + 4 && kinds(dubbed).c === kinds(take).c,
  `dubbing plays the take (its beat and tempo) and adds what you play: ${kinds(dubbed).c} chords kept, ${kinds(dubbed).s} strings added, still ${dubbed.bars} bars`);
take = dubbed;
await page.click('#play');   // stop the loop

// auto-styles: hold a mug and it plays the chord for you, in time
const styles = await page.evaluate(async () => {
  const e = window.cozy.eng, out = {}, C = { root: 0, shape: 'maj', label: 'C' };
  for (const st of ['up', 'down', 'updown', 'random', 'strum', 'tremolo', 'stab']) {
    e.style = st; e.bpm = 150; e.stop();
    e.rec = { start: e.ctx.currentTime, end: 1e9, bars: 99, ev: [] };
    e.press(0, C);
    await new Promise((r) => setTimeout(r, 820));
    e.release();
    const stopAt = e.ctx.currentTime - e.rec.start;
    await new Promise((r) => setTimeout(r, 300));
    const ev = e.rec.ev; e.rec = null;
    const s = ev.filter((x) => x.k === 's');
    out[st] = { quiet: ev.some((x) => x.k === 'c' && x.q), notes: s.map((x) => x.m), times: s.map((x) => x.t), late: s.filter((x) => x.t > stopAt + 0.12).length, lens: s.filter((x) => x.len).length };
  }
  e.style = 'chord'; e.bpm = 150;
  return out;
});
const asc = (l) => l.every((m, k) => !k || m > l[k - 1]), desc = (l) => l.every((m, k) => !k || m < l[k - 1]);
check(Object.values(styles).every((x) => x.quiet && x.late === 0) && asc(styles.up.notes.slice(0, 7)) && desc(styles.down.notes.slice(0, 7)) && styles.up.notes.length >= 7 && styles.up.notes.length <= 10
  && styles.updown.notes[7] < styles.updown.notes[6] && styles.tremolo.notes.length >= 2 * styles.up.notes.length - 3 && styles.stab.lens >= 3 && styles.stab.notes.length % 3 === 0 && styles.strum.notes.length >= 10,
  `hold a mug and it plays for you, in time, stopping when let go: arpeggio up ${styles.up.notes.slice(0, 7).join(' ')}, down ${styles.down.notes.slice(0, 7).join(' ')}, up-down, random, strum (${styles.strum.notes.length} strings), tremolo (${styles.tremolo.notes.length} notes), stabs (${styles.stab.notes.length / 3} block chords)`);

// Advanced: change a mug's chord; the take follows (Am → D7 on the fourth mug)
const keptTake = await page.evaluate(() => JSON.parse(JSON.stringify(window.cozy.take)));
await page.evaluate(() => { const t = window.cozy.take; t.ev.push({ t: 2, k: 'c', i: 3, ch: { root: 9, shape: 'min', label: 'Am' }, n: [57, 60, 64], v: 'omni' }); window.cozy.take = t; });
await page.click('#menu'); await page.click('[data-do="edit"]');
const am2 = await box('.chord[data-i="3"]');
await touch('.chord[data-i="3"]', 'pointerdown', am2.x + am2.w / 2, am2.y + am2.h / 2);
await page.click('[data-root="2"]'); await page.click('[data-shape="dom7"]');
await page.click('#scrim', { position: { x: 20, y: 20 } });
const edited = await page.evaluate(() => ({ label: document.querySelector('.chord[data-i="3"] b').textContent, mark: document.querySelector('.chord[data-i="3"] small').textContent, taken: window.cozy.take.ev.find((e) => e.k === 'c' && e.i === 3).ch.label, wiggle: document.body.classList.contains('editing') }));
await page.click('#edit-done');
await page.click('#menu'); await page.click('[data-do="unedit"]');
const reset = await page.evaluate(() => ({ label: document.querySelector('.chord[data-i="3"] b').textContent, taken: window.cozy.take.ev.find((e) => e.k === 'c' && e.i === 3).ch.label }));
check(edited.label === 'D7' && edited.mark === '✎' && edited.taken === 'D7' && edited.wiggle && reset.label === 'Am' && reset.taken === 'Am',
  `Change chords: the fourth mug becomes ${edited.label} ✎ and the take follows (${edited.taken}); "back to the key's chords" restores ${reset.label}`);

await page.evaluate((t) => { window.cozy.take = t; }, keptTake);

// play styles: switching chords cancels the old chord's waiting notes, and the new chord starts at once, from its root
const clean = await page.evaluate(async () => {
  const e = window.cozy.eng, C = { root: 0, shape: 'maj', label: 'C' }, F = { root: 5, shape: 'maj', label: 'F' }, runs = [];
  for (const st of ['up', 'tremolo']) for (let k = 0; k < 6; k++) {
    e.style = st; e.bpm = 84;
    e.rec = { start: e.ctx.currentTime, end: 1e9, bars: 99, ev: [] };
    e.press(0, C); await new Promise((r) => setTimeout(r, 300 + k * 37));
    const tF = e.now() - e.rec.start; e.release(); e.press(1, F);
    await new Promise((r) => setTimeout(r, 500)); e.release();
    const after = e.rec.ev.filter((x) => x.k === 's' && x.t >= tF - 0.001); e.rec = null;
    runs.push({ stray: after.filter((x) => ![5, 9, 0].includes(x.m % 12)).length, firstMs: Math.round((after[0].t - tF) * 1000), first: after[0].m });
  }
  e.style = 'chord';
  return runs;
});
check(clean.every((r) => r.stray === 0 && r.firstMs <= 6) && clean.filter((r, k) => k < 6).every((r) => r.first === 53),
  `switching chords in a play style: no stray notes from the old chord (${clean.reduce((n, r) => n + r.stray, 0)} in 12 switches), the new chord at once (${Math.max(...clean.map((r) => r.firstMs))} ms at most), arpeggios from the root`);

// a fast swipe that skips strings between two touch samples still strums them one after another
const spread = await page.evaluate(async () => {
  const e = window.cozy.eng, got = [], orig = e.string.bind(e);
  e.string = (m, v, d) => { got.push(d || 0); };
  const strip = document.getElementById('strip'), r = strip.getBoundingClientRect(), y = r.top + r.height / 2;
  strip.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, clientX: r.left + 12, clientY: y, bubbles: true }));
  await new Promise((res) => setTimeout(res, 30));
  strip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, clientX: r.left + r.width * 0.55, clientY: y, bubbles: true }));
  strip.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, clientX: r.left + r.width * 0.55, clientY: y, bubbles: true }));
  e.string = orig;
  return got;
});
check(spread.length >= 5 && spread.slice(2).every((d, k) => d > spread[k + 1]), `a fast swipe's skipped strings are spread out like a strum (${spread.map((d) => Math.round(d * 1000)).join(', ')} ms)`);

// leaving the app lets go of a held chord (no stuck organ note)
await page.keyboard.down('1');
const heldBefore = await page.evaluate(() => !!window.cozy.eng.held);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
const heldAfter = await page.evaluate(() => !!window.cozy.eng.held);
await page.keyboard.up('1');
check(heldBefore && !heldAfter, 'leaving the app lets go of a held organ chord');

// saving renders notes just ahead of time: a long, busy take no longer slows down more than its length
const speed = await page.evaluate(async () => {
  const { renderTake, restyle } = await import('/chords/js/engine.js');
  const { chordsOf, chordNotes } = await import('/chords/js/theory.js');
  const make = (bars) => { const ch = chordsOf(0, 'major'), bar = 60 / 84 * 4, ev = []; for (let k = 0; k < bars; k++) { const c = ch[k % 4]; ev.push({ t: k * bar, k: 'c', i: k % 4, ch: { root: c.root, shape: c.shape, label: c.label }, n: chordNotes(c), v: 'harp' }); } return restyle({ v: 1, bpm: 84, beat: 'cozy', dur: bars * bar, bars, key: 0, mode: 'major', ev }, 'harp', 'up'); };
  const time = async (t) => { const t0 = performance.now(); await renderTake(t, { sr: 44100, tail: 1 }); return performance.now() - t0; };
  const four = await time(make(4)), sixteen = await time(make(16));
  return { four: Math.round(four), sixteen: Math.round(sixteen), ratio: +(sixteen / four).toFixed(1) };
});
check(speed.ratio < 5.5, `saving: a 16-bar arpeggio take renders in ${speed.sixteen} ms, ${speed.ratio}× a 4-bar one (it was 10–11×)`);


// the take follows a new sound and a new play style (and back again)
await page.click('#voice'); await page.click('[data-v="harp"]');
const harp = await page.evaluate(() => window.cozy.take.ev.every((e) => e.k === 'u' || e.v === 'harp'));
await page.click('[data-st="up"]');
const arp = await page.evaluate(() => { const ev = window.cozy.take.ev; return { q: ev.filter((e) => e.k === 'c').every((e) => e.q), made: ev.filter((e) => e.a).length, hand: ev.filter((e) => e.k === 's' && !e.a).length }; });
await page.click('[data-st="chord"]'); await page.click('[data-v="omni"]');
const back = await page.evaluate(() => { const ev = window.cozy.take.ev; return { q: ev.some((e) => e.q), made: ev.filter((e) => e.a).length, hand: ev.filter((e) => e.k === 's' && !e.a).length, omni: ev.every((e) => e.k === 'u' || e.v === 'omni') }; });
await page.click('#scrim', { position: { x: 20, y: 20 } });
check(harp && arp.q && arp.made >= 4 && arp.hand === 4 && !back.q && back.made === 0 && back.hand === 4 && back.omni,
  `the take follows the sound (all harp) and the style (an arpeggio of ${arp.made} notes over its chords, the 4 hand-strummed notes kept), and back again`);

// every save, from the menu
await page.click('#menu');
const save = async (what) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(`[data-save="${what}"]`)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };
const song = await save('song'), loop = await save('loop');
check(Math.abs(+probe(song) - (4 * bar + 3)) < 0.02 && Math.abs(+probe(loop) - 4 * bar) < 0.02, `Song WAV ${(+probe(song)).toFixed(2)} s (the take plus its ring-out), Loop WAV ${(+probe(loop)).toFixed(2)} s (exactly the take)`);
const lufs = String(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${song}" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "^ +I:"`])).trim();
check(/I:\s+-1[3-5]/.test(lufs), `the song is mastered to a gentle level (${lufs})`);
const mid = fs.readFileSync(await save('midi'));
let tracks = 0; for (let i = 0; i < mid.length - 3; i++) if (mid[i] === 0x4d && mid[i + 1] === 0x54 && mid[i + 2] === 0x72 && mid[i + 3] === 0x6b) tracks++;
const ons = new Set(); for (let i = 0; i < mid.length - 2; i++) if ((mid[i] & 0xf0) === 0x90 && mid[i + 2] > 0 && mid[i + 1] < 128) ons.add(`${mid[i] & 15}:${mid[i + 1]}`);
check(mid.slice(0, 4).toString() === 'MThd' && tracks === 4 && ons.has('0:60') && ons.has('0:53') && ons.has('2:48') && ons.has('2:41') && ons.has('9:36'), `MIDI: chords, bass and drums on their own tracks (${tracks} tracks: the C and F chords, their bass notes C3 and F2, the kick)`);
const zip = await save('stems'), list = String(execFileSync('unzip', ['-Z1', zip])).trim().split('\n').map((n) => n.split('/').pop());
const dir = fs.mkdtempSync(path.join(OUT, 'st-')); execFileSync('unzip', ['-q', zip, '-d', dir]);
const lens = [...new Set(String(execFileSync('sh', ['-c', `find "${dir}" -name '*.wav'`])).trim().split('\n').map((f) => (+probe(f)).toFixed(2)))];
check(list.join() === 'mix.wav,1-chords.wav,2-strings.wav,3-bass.wav,4-drums.wav' && lens.length === 1, `stems: ${list.join(', ')}, all ${lens.join()} s`);

// the hand-over: Boba opens with the take as sampler tracks
await Promise.all([page.waitForURL(/\/boba\//, { timeout: 30000 }), page.click('[data-boba]')]);
await page.waitForFunction(() => window.bubbloop && window.bubbloop.project, null, { timeout: 30000 });
await page.evaluate(() => document.getElementById('btn-start').click());
await page.waitForTimeout(1200);
const boba = await page.evaluate(() => {
  const p = window.bubbloop.project;
  return { name: p.name, bpm: p.bpm, tracks: p.tracks.map((t) => `${t.name}(${t.role}):${t.smp ? Object.keys(t.smp.kit).length : '-'}`), bars: p.sections.map((s) => s.bars).join(), hits: p.tracks.map((t) => p.sections.reduce((n, s) => n + s.ev[t.id].length, 0)) };
});
check(boba.name === 'Cozy Chords in C major' && boba.bpm === 150 && /^Cozy Chords\(pads\):2 Cozy Strings\(melody\):\d+ Cozy Bass\(bass\):\d+ Cozy Beat\(drums\):3$/.test(boba.tracks.join(' ')) && boba.bars === '4' && boba.hits[0] >= 2,
  `Send to Boba: ${boba.name}, ${boba.tracks.join(', ')}, one ${boba.bars}-bar loop (${boba.hits.join('/')} notes)`);

// fits the screen: small phone, big phone, laptop
const fits = [];
for (const [w, h] of [[360, 640], [430, 932], [1440, 820]]) {
  const p2 = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, serviceWorkers: 'block' })).newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(`${base}/chords/`); await p2.click('#go'); await p2.waitForTimeout(300);
  const r = await p2.evaluate(() => {
    const all = [...document.querySelectorAll('.chord'), document.getElementById('strip'), document.getElementById('menu'), document.getElementById('play')].map((e) => e.getBoundingClientRect());
    const b = document.querySelector('.chord').getBoundingClientRect();
    return { inside: all.every((r) => r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5), bubble: Math.round(b.width) };
  });
  fits.push(r.inside && r.bubble >= 60); if (!r.inside || r.bubble < 60) console.log('   ', w, h, JSON.stringify(r));
  if (w === 1440) await p2.screenshot({ path: path.join(OUT, 'laptop.png') });
}
check(fits.every(Boolean), `fits a small phone, a big phone and a laptop (${fits.filter(Boolean).length}/3)`);
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(`output in ${OUT}`);
console.log(failed ? `${failed} failed` : 'all Cozy Chords checks passed');
process.exit(failed ? 1 : 0);
