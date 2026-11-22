// Pop Pads → Boba Beats: both apps served from one site (as on shalonely.com),
// a beat sent from Pop Pads opens in Boba as a song whose "Pop Pads" sampler
// track holds the drums and the pattern; and the Boba song file works too.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = { pop: path.resolve(here, '../web'), boba: path.resolve(here, '../../bubbloop/web') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname), m = /^\/(pop|boba)(\/.*)?$/.exec(u);
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
const context = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0; const check = (ok, m) => { console.log((ok ? '  ok   ' : '  FAIL ') + m); if (!ok) failed++; };

await page.goto(`${base}/pop/`);
await page.evaluate(() => window.popPads.start());
await page.waitForFunction(() => window.popPads.eng && window.popPads.eng.bufs);
// a beat: chain 1 → 2 → 1 (three bars, so Boba gets four), a pitched-up snare, a nudged hat
const sent = await page.evaluate(() => {
  const s = window.popPads.song;
  s.kit = 'lime';
  s.patterns[0] = new Array(16).fill(0); s.patterns[1] = new Array(16).fill(0);
  s.patterns[0][0] = 1 | (1 << 8); s.patterns[0][2] = (1 << 4) | (1 << 12); s.patterns[0][4] = 0b0101010101010101;
  s.patterns[1][0] = 1 | (1 << 10); s.patterns[1][2] = (1 << 4) | (1 << 12);
  s.motion[0] = { mix: {}, pads: { 4: { nudge: [null, null, 0.25, ...new Array(13).fill(null)] }, 2: { pitch: [...new Array(12).fill(null), 7, null, null, null] } } };
  s.fx.verb = 0.5; s.fx.crush = 0.3;
  s.tweaks.lime = []; s.tweaks.lime[2] = { pitch: 5 };
  // a little bass line on the Acid pad: C, then a fifth up
  s.patterns[0][1] = 1 | (1 << 6); s.motion[0].pads[1] = { pitch: [...new Array(6).fill(null), 7, ...new Array(9).fill(null)] };
  s.chain = [0, 1, 0]; s.bpm = 100;
  return { hits: 2 + 2 + 8 + 2 + 2 + 2 + 2 + 8 };
});
await page.evaluate(() => window.popPads.eng.setKit('lime'));
await page.click('#menu');
await Promise.all([page.waitForURL(/\/boba\//, { timeout: 30000 }), page.click('[data-boba]')]);
check(/\/boba\//.test(page.url()), `Send to Boba Beats opens Boba (${page.url().replace(base, '')})`);
await page.waitForFunction(() => window.bubbloop && window.bubbloop.project, null, { timeout: 30000 });
await page.waitForFunction(() => window.bubbloop); await page.evaluate(() => window.bubbloop.engine.wake(window.bubbloop.project));
await page.waitForTimeout(1500);
const got = await page.evaluate(async () => {
  const p = window.bubbloop.project, t = p.tracks[0], sec = p.sections[0], ev = sec.ev[t.id], all = p.sections.reduce((n, x) => n + x.ev[t.id].length, 0);
  const { getSample } = await import('/boba/js/samples.js');
  const ids = Object.entries(t.smp.kit);
  const lens = ids.map(([slot, id]) => { const sm = getSample(id); return sm ? sm.buffer.duration : 0; });
  let top = 0; for (const id of p.tracks.filter((x) => x.smp).flatMap((x) => Object.values(x.smp.kit))) { const b = getSample(id).buffer; for (let c = 0; c < b.numberOfChannels; c++) for (const x of b.getChannelData(c)) top = Math.max(top, Math.abs(x)); }
  return {
    name: p.name, inst: t.inst, mode: t.smp.mode, bars: sec.bars, bpm: p.bpm, slots: ids.map(([k]) => +k).sort((a, b) => a - b),
    lens, top, events: all, sections: p.sections.map((x) => x.bars).join(), songOrder: p.song.map((b) => `${'AB'[b.sec]}×${b.rep}`).join(' '), stepVersion: ev.some((e) => e.r === 0 && e.c === 4 && e.t === 12 * 24), hatNudged: ev.some((e) => e.r === 1 && e.c === 0 && e.t === 2 * 24 + 6), focus: window.bubbloop.trackId === t.id,
    bass: (() => { const b = p.tracks[1], e = p.sections.reduce((n, x) => n + x.ev[b.id].length, 0); return { name: b.name, role: b.role, slots: Object.keys(b.smp.kit).join(), e }; })(),
    url: location.search, others: p.tracks.slice(1).map((x) => x.role).join(','), again: localStorage.getItem('bubbloop.last') === p.id,
  };
});
check(got.name === 'Pop Pads Lime beat' && got.inst === 'sampler' && got.mode === 'kit' && got.focus && got.others === 'bass,pads,melody',
  `Boba opens a new song with a Pop Pads sampler kit track first, then bass, chords and melody (${got.name})`);
check(got.slots.join() === '0,2,4,5' && got.lens.every((d) => d > 0.05), `the drums land on Boba's bubbles in the same layout, a step's own pitch on a spare bubble (slots ${got.slots}), sounds loaded (${got.lens.map((d) => d.toFixed(2)).join(', ')} s)`);
check(Math.abs(got.top - 0.9) < 0.03, `the kit arrives at Boba's own sample level: its loudest sound peaks at 90% (${got.top.toFixed(2)})`);
check(got.bass.name === 'Pop Acid' && got.bass.role === 'bass' && got.bass.slots === '0,1' && got.bass.e === 2, `the bass pad comes across as Boba's bass track, one bubble per note (${got.bass.name}: bubbles ${got.bass.slots}, ${got.bass.e} notes)`);
check(got.stepVersion, 'the step with its own settings plays its own version of the drum');
check(got.sections === '1,1' && got.songOrder === 'A×1 B×1 A×1' && got.bpm === 100 && got.events === 2 + 2 + 8 + 2 + 2, `each pattern is a Boba loop and the chain is the song (${got.songOrder}; ${got.events} notes)`);
check(got.hatNudged, 'a nudged hit keeps its nudge');
check(got.url === '' && got.again, 'the song is saved in Boba, and the hand-over is used up');
// the Pop Pads track actually sounds: play Boba and listen to its output level
const level = await page.evaluate(async () => {
  const e = window.bubbloop.engine, an = e.ctx.createAnalyser(); an.fftSize = 2048;
  e.g.master.output.connect(an);
  document.getElementById('btn-play').click();
  const d = new Float32Array(2048); let peak = 0;
  for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 50)); an.getFloatTimeDomainData(d); for (const x of d) peak = Math.max(peak, Math.abs(x)); }
  document.getElementById('btn-play').click();
  return peak;
});
check(level > 0.3, `Boba plays the Pop Pads drums out loud (peak ${level.toFixed(2)})`);

// the song-file route (the Android apps): the same file imports into Boba
await page.goto(`${base}/pop/`);
const file = await page.evaluate(async () => { const { bobaSong } = await import('/pop/js/export.js'); return JSON.stringify(await bobaSong(window.popPads.song)); });
fs.writeFileSync(path.join(here, '.handoff.bobabeats.json'), file);
await page.goto(`${base}/boba/`);
await page.waitForFunction(() => window.bubbloop && window.bubbloop.project);
await page.waitForFunction(() => window.bubbloop); await page.evaluate(() => window.bubbloop.engine.wake(window.bubbloop.project)); await page.waitForTimeout(500);
await page.evaluate(async () => { const { openSheets } = await import('/boba/js/ui/sheets.js'); openSheets.project ? openSheets.project() : null; });
await page.waitForTimeout(400);
const input = await page.$('#p-file');
if (input) {
  await input.setInputFiles(path.join(here, '.handoff.bobabeats.json'));
  await page.waitForTimeout(1500);
}
const imported = await page.evaluate(() => ({ name: window.bubbloop.project.name, inst: window.bubbloop.project.tracks[0].inst }));
check(!!input && /^Pop Pads .+ beat$/.test(imported.name) && imported.inst === 'sampler', `the Boba song file imports too (${imported.name})`);
fs.rmSync(path.join(here, '.handoff.bobabeats.json'), { force: true });
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all hand-over checks passed');
process.exit(failed ? 1 : 0);
