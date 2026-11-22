// Pop Pads, the tuned pads: every kit has a bass, a chord and a lead in the
// same places, they pitch exactly (re-rendered, not sped up), play one note
// at a time, no drum is too loud, and the pitch buttons step by intervals.
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

const r = await page.evaluate(async () => {
  const { KITS, KIT_ORDER, renderKit, renderTone, loudness, lowEnd, TONAL } = await import('/js/kits.js');
  const sr = 48000, out = { kits: [], loud: [], low: [], pitch: [] };
  // the pitch of a buffer, by autocorrelation over a slice after the attack
  const f0 = (b, lo, hi) => {
    const d = b.getChannelData(0), a = Math.round(0.2 * sr), n = Math.round(0.08 * sr);
    let best = 0, lag = 0;
    for (let L = Math.floor(sr / hi); L <= Math.ceil(sr / lo); L++) { let c = 0; for (let i = a; i < a + n; i++) c += d[i] * d[i + L]; if (c > best) { best = c; lag = L; } }
    return sr / lag;
  };
  for (const id of KIT_ORDER) {
    const k = KITS[id], bufs = await renderKit(id, sr);
    out.kits.push(`${id}:${TONAL.map((i) => k.pads[i].tone).join('/')}`);
    for (let i = 0; i < 16; i++) if (!k.pads[i].tone) out.loud.push([id, k.pads[i].name, loudness(bufs[i].getChannelData(0), sr)]);
    for (let i = 0; i < 16; i++) out.low.push([id, k.pads[i].name, lowEnd(bufs[i].getChannelData(0), sr), lowEnd(bufs[i].getChannelData(0), sr, 1.2)]);
    // the bass, an octave and a fifth up: the right notes, about the same length
    const b0 = bufs[1], b7 = await renderTone(id, 1, 7, sr), b12 = await renderTone(id, 1, 12, sr);
    out.pitch.push({ id, f: f0(b0, 40, 110), f7: f0(b7, 60, 170), f12: f0(b12, 80, 220), len: [b0.duration, b12.duration] });
  }
  return out;
});
check(r.kits.every((k) => k.endsWith(':bass/chord/lead')), `every kit has a bass (pad 2), a chord and a lead (top right): ${r.kits.join(' ')}`);
const hot = r.loud.filter(([, , l]) => l > -8.9);
check(!hot.length, `no drum is louder than Cream Soda's loudest (−9 LUFS): loudest ${r.loud.sort((a, b) => b[2] - a[2]).slice(0, 3).map(([k, n, l]) => `${k} ${n} ${l.toFixed(1)}`).join(', ')}`);
const boomy = r.low.filter(([, , l]) => l > -13.9);
check(!boomy.length, `no pad's low end (below 120 Hz) goes over −14 dB, so subs don't rattle studio speakers: hottest ${r.low.sort((a, b) => b[2] - a[2]).slice(0, 3).map(([k, n, l]) => `${k} ${n} ${l.toFixed(1)}`).join(', ')}`);
const rumbly = r.low.filter(([, , , l]) => l > -20.9);
check(!rumbly.length, `no 808 tail rumbles on: the low end over 1.2 s stays under −21 dB (${rumbly.map(([k, n, , l]) => `${k} ${n} ${l.toFixed(1)}`).join(', ') || 'all clear'})`);
const cents = (a, b) => 1200 * Math.log2(a / b);
const tuned = r.pitch.every((p) => Math.abs(cents(p.f, 65.406)) < 40 && Math.abs(cents(p.f7, 65.406 * 1.4983)) < 40 && Math.abs(cents(p.f12, 130.81)) < 40 && Math.abs(p.len[0] - p.len[1]) < 0.01);
check(tuned, `the basses are on C2 and pitch exactly, keeping their length: ${r.pitch.map((p) => `${p.id} ${p.f.toFixed(0)}/${p.f7.toFixed(0)}/${p.f12.toFixed(0)} Hz`).join(', ')}`);

// one note at a time: two chord hits 0.1 s apart, the first one's tail is cut
const choke = await page.evaluate(async () => {
  const { Graph } = await import('/js/engine.js');
  const { renderKit } = await import('/js/kits.js');
  const sr = 48000, run = async (two) => {
    const ctx = new OfflineAudioContext(2, sr, sr), g = await Graph.create(ctx), bufs = await renderKit('grape', sr);
    g.setFx({ filter: 0, drive: 0, crush: 0, verb: 0, lfo: 0, lfoRate: 2, lfoTo: 'filter' }, 120, 0);
    const tw = { pitch: 0, len: 1, filt: 0, vol: 0.85, crush: 0, lfo: 0, lfoTo: 'pitch' };
    g.play(14, bufs[14], 0, tw); if (two) g.play(13, bufs[13], 0.1, { ...tw, vol: 0 }), g.play(14, bufs[14], 0.1, { ...tw, vol: 0 });
    const d = (await ctx.startRendering()).getChannelData(0); let e = 0; for (let i = Math.round(0.15 * sr); i < Math.round(0.3 * sr); i++) e += d[i] * d[i]; return e;
  };
  return { ring: await run(false), cut: await run(true) };
});
check(choke.cut < choke.ring * 0.01, `a new chord hit cuts the last one's tail (${choke.ring.toFixed(1)} → ${choke.cut.toFixed(4)})`);

// play a pad, then Steps opens on it; the pitch buttons step by intervals
await page.evaluate(() => window.popPads.start());
await page.waitForFunction(() => window.popPads.eng && window.popPads.eng.bufs);
await page.evaluate(() => window.popPads.eng.setKit('cola'));
const pad14 = await page.$('.pad[data-pad="14"]'), box = await pad14.boundingBox();
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.click('[data-mode="steps"]');
const selName = await page.evaluate(() => document.querySelector('#sounds .on').textContent);
check(selName === 'Synth', `the pad last played is the one Steps opens on (${selName})`);
const seen = [];
for (let k = 0; k < 6; k++) { await page.click('#pitch-up'); seen.push(await page.evaluate(() => document.getElementById('pitch-val').innerText.replace(/\n/g, ' '))); }
for (let k = 0; k < 6; k++) await page.click('#pitch-dn');
seen.push(await page.evaluate(() => document.getElementById('pitch-val').innerText.replace(/\n/g, ' ')));
await page.click('#pitch-val'); await page.click('#pitch-up');
seen.push(await page.evaluate(() => document.getElementById('pitch-val').innerText.replace(/\n/g, ' ')));
const pitchNow = await page.evaluate(async () => { const { tweakOf } = await import('/js/engine.js'); return tweakOf(window.popPads.song, 14).pitch; });
check(seen.slice(0, 5).map((x) => x.split(' +')[0]).join(',') === 'minor 3rd up,major 3rd up,4th up,5th up,octave up' && /octave up/.test(seen[5]) && /^minor 3rd down -3/.test(seen[6]) && /whole step down -2/.test(seen[7]) && pitchNow === -2,
  `+ and − step through the intervals, semitones underneath; the middle switches to single semitones: ${seen.join(' | ')}`);
// MIDI: drums on channel 10, the chord on a track of its own with its real notes
const midi = await page.evaluate(async () => {
  const s = window.popPads.song; s.patterns[s.cur] = new Array(16).fill(0); s.patterns[s.cur][0] = 1; s.patterns[s.cur][14] = 1 << 4; s.patterns[s.cur][1] = 1 << 8; s.chain = [s.cur];
  const { patternMidi } = await import('/js/export.js');
  const b = patternMidi(s); let tracks = 0; for (let i = 0; i < b.length - 3; i++) if (b[i] === 0x4d && b[i + 1] === 0x54 && b[i + 2] === 0x72 && b[i + 3] === 0x6b) tracks++;
  const ons = []; for (let i = 0; i < b.length - 2; i++) if ((b[i] & 0xf0) === 0x90 && b[i + 2] === 100) ons.push(`${b[i] & 15}:${b[i + 1]}`);
  return { tracks, ons: [...new Set(ons)].sort().join(' ') };
});
check(midi.tracks === 3 && /0:36/.test(midi.ons) && /1:46 1:49 1:53/.test(midi.ons) && /9:36/.test(midi.ons), `MIDI: drums, bass and chord on their own tracks, bass on C2, the chord two steps down (${midi.ons})`);
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all tuned-pad checks passed');
process.exit(failed ? 1 : 0);
