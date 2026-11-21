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

// record a take with the beat: a bar of clicks, then two chords
await page.evaluate(() => { const c = window.cozy; c.S.beat = 'cozy'; c.S.bpm = 150; c.eng.beat = 'cozy'; c.eng.bpm = 150; });
await page.click('#rec');
const bar = 4 * 60 / 150;
await page.waitForTimeout(bar * 1000 + 250);
const tap = async (i) => { const b = await box(`.chord[data-i="${i}"]`); await touch(`.chord[data-i="${i}"]`, 'pointerdown', b.x + b.w / 2, b.y + b.h / 2); await page.waitForTimeout(250); await touch(`.chord[data-i="${i}"]`, 'pointerup', b.x + b.w / 2, b.y + b.h / 2); };
await tap(0); await page.waitForTimeout(bar * 1000 - 250); await tap(1);
await page.waitForTimeout(bar * 500);
await page.click('#rec');
const take = await page.evaluate(() => window.cozy.take);
const chordsIn = take ? take.ev.filter((e) => e.k === 'c' && !e.carried).map((e) => e.ch.label) : [];
check(!!take && take.bars === 2 && Math.abs(take.dur - 2 * bar) < 0.01 && chordsIn.join() === 'C,F' && take.beat === 'cozy', `a recorded take: ${take && take.bars} bars, ${take && take.dur} s, chords ${chordsIn.join(' → ')}, with the beat`);
await page.click('#play');   // stop the beat

// every save, from the menu
await page.click('#menu');
const save = async (what) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(`[data-save="${what}"]`)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };
const song = await save('song'), loop = await save('loop');
check(Math.abs(+probe(song) - (2 * bar + 3)) < 0.02 && Math.abs(+probe(loop) - 2 * bar) < 0.02, `Song WAV ${(+probe(song)).toFixed(2)} s (the take plus its ring-out), Loop WAV ${(+probe(loop)).toFixed(2)} s (exactly the take)`);
const lufs = String(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${song}" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "^ +I:"`])).trim();
check(/I:\s+-1[3-5]/.test(lufs), `the song is mastered to a gentle level (${lufs})`);
const mid = fs.readFileSync(await save('midi'));
let tracks = 0; for (let i = 0; i < mid.length - 3; i++) if (mid[i] === 0x4d && mid[i + 1] === 0x54 && mid[i + 2] === 0x72 && mid[i + 3] === 0x6b) tracks++;
const ons = new Set(); for (let i = 0; i < mid.length - 2; i++) if ((mid[i] & 0xf0) === 0x90 && mid[i + 2] > 0 && mid[i + 1] < 128) ons.add(`${mid[i] & 15}:${mid[i + 1]}`);
check(mid.slice(0, 4).toString() === 'MThd' && tracks === 3 && ons.has('0:60') && ons.has('0:53') && ons.has('2:48') && ons.has('2:41') && ons.has('9:36'), `MIDI: chords, bass and drums on their own tracks (${tracks} tracks: the C and F chords, their bass notes C3 and F2, the kick)`);
const zip = await save('stems'), list = String(execFileSync('unzip', ['-Z1', zip])).trim().split('\n').map((n) => n.split('/').pop());
const dir = fs.mkdtempSync(path.join(OUT, 'st-')); execFileSync('unzip', ['-q', zip, '-d', dir]);
const lens = [...new Set(String(execFileSync('sh', ['-c', `find "${dir}" -name '*.wav'`])).trim().split('\n').map((f) => (+probe(f)).toFixed(2)))];
check(list.join() === 'mix.wav,1-chords.wav,2-bass.wav,3-drums.wav' && lens.length === 1, `stems: ${list.join(', ')}, all ${lens.join()} s`);

// the hand-over: Boba opens with the take as sampler tracks
await Promise.all([page.waitForURL(/\/boba\//, { timeout: 30000 }), page.click('[data-boba]')]);
await page.waitForFunction(() => window.bubbloop && window.bubbloop.project, null, { timeout: 30000 });
await page.evaluate(() => document.getElementById('btn-start').click());
await page.waitForTimeout(1200);
const boba = await page.evaluate(() => {
  const p = window.bubbloop.project;
  return { name: p.name, bpm: p.bpm, tracks: p.tracks.map((t) => `${t.name}(${t.role}):${t.smp ? Object.keys(t.smp.kit).length : '-'}`), bars: p.sections.map((s) => s.bars).join(), hits: p.tracks.map((t) => p.sections.reduce((n, s) => n + s.ev[t.id].length, 0)) };
});
check(boba.name === 'Cozy Chords in C major' && boba.bpm === 150 && /^Cozy Chords\(pads\):2 Cozy Bass\(bass\):\d+ Cozy Beat\(drums\):3$/.test(boba.tracks.join(' ')) && boba.bars === '2' && boba.hits[0] >= 2,
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
