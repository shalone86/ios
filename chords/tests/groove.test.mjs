// A groove from Pop Pads in Cozy Chords: made in Pop Pads, sent over, it is
// a beat in Cozy: Pop's own drums, and the kit's bass following the chords
// (with its steps' pitches as intervals); in takes, MIDI and Boba too.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = { chords: path.resolve(here, '../web'), boba: path.resolve(here, '../../bubbloop/web'), pop: path.resolve(here, "../../pop/web") };
const OUT = fs.mkdtempSync(path.join(process.env.CHORDS_TEST_OUT || os.tmpdir(), 'cozy-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname), m = /^\/(chords|boba|pop)(\/.*)?$/.exec(u);
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

// a beat in Pop Pads (Lime): kick, snare, hats, and a bass line: root on 1, a fifth up on step 7, root on 9
await page.goto(`${base}/pop/`);
await page.click('#go');
await page.waitForFunction(() => window.popPads.eng && window.popPads.eng.bufs);
await page.evaluate(() => {
  const s = window.popPads.song; s.kit = 'lime'; s.bpm = 96; s.swing = 0;
  s.patterns[0] = new Array(16).fill(0); s.chain = [0]; s.cur = 0;
  s.patterns[0][0] = 1 | (1 << 8); s.patterns[0][2] = (1 << 4) | (1 << 12); s.patterns[0][4] = 0b0101010101010101;
  s.patterns[0][1] = 1 | (1 << 6) | (1 << 8);
  s.motion[0] = { mix: {}, pads: { 1: { pitch: [...new Array(6).fill(null), 7, ...new Array(9).fill(null)] } } };
});
await page.evaluate(() => window.popPads.eng.setKit('lime'));
await page.click('#menu');
await Promise.all([page.waitForURL(/\/chords\//, { timeout: 60000 }), page.click('[data-cozy]')]);
await page.waitForFunction(() => window.cozy && window.cozy.S.beat.startsWith('pop:'), null, { timeout: 15000 });
const arrived = await page.evaluate(async () => {
  const { GROOVES } = await import('/chords/js/engine.js');
  const b = GROOVES.get(window.cozy.S.beat);
  return { name: b.name, bpm: window.cozy.S.bpm, drums: b.groove.names.join(','), notes: b.groove.notes.length, url: location.search, chip: document.getElementById('beat').textContent };
});
check(arrived.name === 'Lime groove' && arrived.bpm === 96 && arrived.chip === 'Lime groove' && arrived.url === '' && /Punch/.test(arrived.drums) && arrived.notes === 19,
  `Send to Cozy Chords: "${arrived.name}" arrives as the beat, at Pop's 96 bpm, with Pop's own drums (${arrived.drums}) and ${arrived.notes} bass notes`);

// in the Beat menu, under "Grooves from Pop Pads"
await page.click('#go'); await page.waitForFunction(() => window.cozy.eng);
await page.click('#beat');
const listed = await page.evaluate(() => [...document.querySelectorAll('#sheet [data-b]')].map((b) => b.textContent).filter((t) => /from Pop Pads/.test(t)));
await page.click('#scrim', { position: { x: 20, y: 20 } });
check(listed.length === 1 && /Acid on bass/.test(listed[0]), `the Beat menu lists it, with its bass (${listed[0]})`);

// the bass follows the chords: C for a bar, then F; root, a fifth up, root, as in Pop
const P = await page.evaluate(async () => {
  const { performance } = await import('/chords/js/engine.js');
  const bar = 60 / 96 * 4, beat = window.cozy.S.beat;
  const take = { v: 1, bpm: 96, beat, dur: 2 * bar, bars: 2, key: 0, mode: 'major', ev: [
    { t: 0, k: 'c', i: 0, ch: { root: 0, shape: 'maj', label: 'C' }, n: [60, 64, 67], v: 'harp' },
    { t: bar, k: 'c', i: 1, ch: { root: 5, shape: 'maj', label: 'F' }, n: [53, 57, 60], v: 'harp' }] };
  window.cozy.take = take;
  const p = performance(take);
  return { bass: p.bass.map((b) => b.m).join(','), groove: p.bass.every((b) => b.g), drums: p.drums.length, kinds: [...new Set(p.drums.map((d) => d.kind))].join() };
});
check(P.bass === '48,55,48,41,48,41' && P.groove && P.drums === 2 * (2 + 2 + 8) && P.kinds === 'g',
  `the kit's bass plays Pop's bass line over Cozy's chords: C bar ${P.bass.split(',').slice(0, 3).join(' ')}, F bar ${P.bass.split(',').slice(3).join(' ')}; ${P.drums} drum hits, all Pop's own`);

// it loops live, and saves: a Loop WAV with sound, MIDI with Pop's GM drum notes, Boba with the groove's drums and bass
await page.click('#play');
await page.waitForTimeout(600);
const looping = await page.evaluate(() => !!window.cozy.eng.loop);
await page.click('#play');
await page.click('#menu');
const save = async (what) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(`[data-save="${what}"]`)]); const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f); return f; };
const wav = await save('loop');
const vol = String(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${wav}" -af volumedetect -f null - 2>&1 | grep max_volume`])).trim();
const mid = fs.readFileSync(await save('midi'));
const drumNotes = new Set(); for (let i = 0; i < mid.length - 2; i++) if (mid[i] === 0x99 && mid[i + 2] > 0) drumNotes.add(mid[i + 1]);
check(looping && /max_volume: -[0-9.]+ dB/.test(vol) && drumNotes.has(36) && drumNotes.has(38) && drumNotes.has(42), `it loops live, and saves: a loop WAV (${vol.split(':').pop().trim()} peak), MIDI with the GM drums ${[...drumNotes].sort().join(', ')}`);
await Promise.all([page.waitForURL(/\/boba\//, { timeout: 60000 }), page.click('[data-boba]')]);
await page.waitForFunction(() => window.bubbloop && window.bubbloop.project, null, { timeout: 30000 });
const boba = await page.evaluate(() => window.bubbloop.project.tracks.filter((t) => t.smp).map((t) => `${t.name}:${Object.keys(t.smp.kit).length}`).join(' '));
check(/Cozy Chords:2/.test(boba) && /Cozy Bass \(Lime groove\):\d+/.test(boba) && /Lime groove:3/.test(boba), `and on to Boba: ${boba}`);

// removing it from the Beat menu
await page.goto(`${base}/chords/`); await page.click('#go'); await page.waitForFunction(() => window.cozy.eng);
await page.click('#beat');
await page.click('[data-del]');
const gone = await page.evaluate(async () => { const { GROOVES } = await import('/chords/js/engine.js'); return { n: GROOVES.size, beat: window.cozy.S.beat }; });
check(gone.n === 0 && gone.beat === 'none', 'a groove can be removed from the Beat menu');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all groove checks passed');
process.exit(failed ? 1 : 0);
