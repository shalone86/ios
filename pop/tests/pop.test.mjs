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
check(kits.length === 7 && kits.every((k) => k.pads === 16 && k.silent === 0), `7 flavours, 16 pads each, all with sound (${kits.map((k) => k.id).join(', ')})`);

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

// stutter: hold a pad and slide up; jumble: slide down
const playedSteps = async (ms) => { await page.evaluate(() => { window.__steps = []; const e = window.popPads.eng, o = e.onStep; e.onStep = (s, p, fx) => { window.__steps.push(fx); o(s, p, fx); }; }); await page.waitForTimeout(ms); return page.evaluate(() => window.__steps); };
await touch('.pad[data-pad="10"]', 'pointerdown', 3); await page.waitForTimeout(300);
await touch('.pad[data-pad="10"]', 'pointermove', 3, 160);
const st = await playedSteps(900);
const perfS = await page.evaluate(() => ({ ...window.popPads.eng.perf }));
const shaking = await page.evaluate(() => document.querySelectorAll('.pad.stutter').length);
await touch('.pad[data-pad="10"]', 'pointermove', 3, -160);
const jb = await playedSteps(1500);
const perfJ = await page.evaluate(() => ({ ...window.popPads.eng.perf }));
await touch('.pad[data-pad="10"]', 'pointerup', 3); await page.waitForTimeout(100);
const after = await page.evaluate(() => ({ ...window.popPads.eng.perf, faces: document.querySelectorAll('.pad.stutter,.pad.jumble').length }));
check(perfS.mode === 'stutter' && perfS.size === 1 && st.filter((x) => x === 'stutter').length >= 3 && shaking === 16, `sliding up stutters (loop of ${perfS.size} step, ${st.filter(Boolean).length} stuttered steps, faces shaking)`);
check(perfJ.mode === 'jumble' && jb.filter((x) => x === 'jumble').length >= 3, `sliding down jumbles (${jb.filter(Boolean).length} jumbled steps)`);
check(after.mode === null && after.faces === 0, 'letting go snaps back to the pattern');

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
for (const s of [4, 12]) await touch(`.step[data-step="${s}"]`, 'pointerdown', 10 + s);
const clap = await page.evaluate(() => window.popPads.song.patterns[0][3]);
check(clap === ((1 << 4) | (1 << 12)), `steps mode writes the clap on steps 5 and 13 (bits ${clap.toString(2)})`);
await page.screenshot({ path: path.join(OUT, 'steps.png') });
await page.click('[data-mode="play"]');

// copy pattern 1 to 2 (hold), then chain 1 → 2 → 1
await page.evaluate(() => { const b = document.querySelector('[data-pat="1"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
await page.waitForTimeout(700);
await page.evaluate(() => { const b = document.querySelector('[data-pat="1"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); b.click(); });
const copied = await page.evaluate(() => JSON.stringify(window.popPads.song.patterns[1]) === JSON.stringify(window.popPads.song.patterns[0]) && window.popPads.song.cur === 1);
await page.click('#chain'); for (const i of [0, 1, 0]) await page.click(`[data-pat="${i}"]`); await page.click('#chain');
const chain = await page.evaluate(() => window.popPads.song.chain.join(','));
check(copied && chain === '0,1,0', `hold copies a pattern, and patterns chain (${chain})`);

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
await page.fill('#f-filter', '-70'); await page.dispatchEvent('#f-filter', 'input');
const lp = await page.evaluate(() => new Promise((r) => setTimeout(() => r(window.popPads.eng.graph.lp.frequency.value), 300)));
check(lp < 2000, `the filter knob closes the low-pass (${Math.round(lp)} Hz)`);
await page.fill('#f-filter', '0'); await page.dispatchEvent('#f-filter', 'input');

// change flavour: the beat stays, the sounds change
await page.click('#kit'); await page.click('[data-kit="cream"]'); await page.waitForTimeout(400); await page.click('#scrim', { position: { x: 20, y: 20 } });
const kitNow = await page.evaluate(() => ({ kit: window.popPads.song.kit, name: document.querySelector('.pad[data-pad="2"] b').textContent, keeps: window.popPads.song.patterns[0][0] }));
check(kitNow.kit === 'cream' && kitNow.name === 'Pssht' && kitNow.keeps, 'a new flavour swaps the sounds and keeps the beat');
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
for (const [w, h, label, zoom] of [[360, 640, 'small phone', 1], [412, 780, 'phone, larger text', 1.15], [915, 380, 'sideways', 1]]) {
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
check(fits.every(Boolean), `fits the screen on a small phone, a phone with larger text, and sideways (${fits.filter(Boolean).length}/${fits.length})`);
check(kept && kept.kit === 'cream' && kept.chain.join() === '0,1,0' && kept.patterns[0][3] === ((1 << 4) | (1 << 12)), 'the song is kept on the device');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
console.log('output in', OUT);
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all Pop Pads checks passed');
process.exit(failed ? 1 : 0);
