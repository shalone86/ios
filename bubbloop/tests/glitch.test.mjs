// Glitch should be chaotic but listenable: over a held organ chord (no drums,
// so any sharp edge is the effect's own), the glitched sound must not click
// or pop: its sharpest sample-to-sample jumps stay close to the clean chord's.
import { serve, openPage } from './lib.mjs';

const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };

const r = await page.evaluate(async () => {
  const S = await import('/js/state.js');
  const { buildGraph } = await import('/js/graph.js');
  const { getKit } = await import('/js/drums.js');
  const { scheduleRange, loopSegments } = await import('/js/seq.js');
  const SR = 44100, LEN = 6;
  async function render(glitch) {
    const p = S.newProject('glitch'); p.bpm = 120; p.master = 'raw';
    const pa = p.tracks[2]; pa.inst = 'organ'; pa.rev = 0; pa.dly = 0;
    p.sections[0].ev[pa.id] = [{ t: 0, d: 760, r: 1, c: 0, v: 0.8, ch: 'triad' }];
    const ctx = new OfflineAudioContext(2, SR * LEN, SR);
    const g = buildGraph(ctx, p, await getKit(SR, p.key), { offline: true, master: false });
    const spt = 60 / (p.bpm * 96);
    for (const seg of loopSegments(p, 0, 3)) scheduleRange(g, p, seg, 0, seg.len, (tk) => 0.02 + tk * spt);
    if (glitch) {
      ctx.suspend(1).then(() => { g.rack.on('glitch', 1, ctx.currentTime); ctx.resume(); });
      ctx.suspend(4.5).then(() => { g.rack.off('glitch', ctx.currentTime); ctx.resume(); });
    }
    const b = await ctx.startRendering();
    return b.getChannelData(0);
  }
  const dry = await render(false), wet = await render(true);
  // the sharpest edges: second difference, i.e. how suddenly the wave changes direction
  const edges = (x, a, z) => {
    const out = [];
    for (let i = Math.floor(a * SR) + 2; i < Math.floor(z * SR); i++) out.push(Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]));
    out.sort((m, n) => n - m);
    return out;
  };
  const d = edges(dry, 1, 4.5), w = edges(wet, 1, 4.5);
  let peak = 0; for (let i = SR; i < 4.5 * SR; i++) peak = Math.max(peak, Math.abs(dry[i]));
  const over = w.filter((v) => v > d[0] * 2).length;   // edges more than twice the sharpest the chord itself has
  let changed = 0; for (let i = SR; i < 4.5 * SR; i++) changed += Math.abs(wet[i] - dry[i]);
  return { dryMax: d[0], wetMax: w[0], ratio: w[0] / d[0], over, peak, changed: changed / (3.5 * SR) };
});
console.log(`    sharpest edge: clean ${r.dryMax.toFixed(4)}, glitched ${r.wetMax.toFixed(4)} (×${r.ratio.toFixed(1)}); ${r.over} samples over twice the clean edge`);
check(r.changed > 0.02, `Glitch still changes the sound plenty (average difference ${r.changed.toFixed(3)})`);
check(r.ratio < 3 && r.over < 40, 'Glitch makes no pops or clicks');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all glitch checks passed');
process.exit(failed ? 1 : 0);
