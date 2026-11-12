// Quick-hit FX tests. Each effect is driven two ways:
//   live       on() and off() called at the moment they happen, the way a
//              finger does it, including very short and very long holds
//   sequenced  recorded into the loop with a known length
// and must (a) change the sound while held, (b) leave no trace once
// released: the output has to return to the untouched mix, in time and level.

import { serve, openPage } from './lib.mjs';

const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };

const results = await page.evaluate(async () => {
  const S = await import('/js/state.js');
  const { buildGraph, FX } = await import('/js/graph.js');
  const { getKit } = await import('/js/drums.js');
  const { scheduleRange, loopSegments } = await import('/js/seq.js');
  const { renderProject } = await import('/js/render.js');

  const SR = 44100, LEN = 9;
  const makeProject = () => {
    const p = S.newProject('fx'); p.bpm = 120; p.master = 'raw';
    const [dr, ba, pa, me] = p.tracks;
    S.applyPattern(p, 0, dr.id, 'house'); p.swing = 0;
    pa.inst = 'organ';
    for (const t of p.tracks) { t.rev = 0; t.dly = 0; }
    p.sections[0].ev[pa.id] = [{ t: 0, d: 760, r: 1, c: 0, v: 0.8, ch: 'triad' }];
    p.sections[0].ev[ba.id] = [{ t: 0, d: 180, r: 0, c: 0, v: 0.8 }, { t: 384, d: 180, r: 0, c: 3, v: 0.8 }];
    return p;
  };

  // Render the loop for LEN seconds, calling `script(g, at)` so that it can
  // poke the rack at chosen moments exactly as live code would.
  async function live(actions) {
    const p = makeProject();
    const ctx = new OfflineAudioContext(2, SR * LEN, SR);
    const g = buildGraph(ctx, p, await getKit(SR, p.key), { offline: true, master: false });
    const spt = 60 / (p.bpm * 96);
    for (const seg of loopSegments(p, 0, 3)) scheduleRange(g, p, seg, 0, seg.len, (tk) => 0.02 + tk * spt);
    const thrown = [];
    for (const a of actions) {
      ctx.suspend(a.t).then(() => {
        try { a.run(g.rack, ctx.currentTime); } catch (e) { thrown.push(`${a.label}: ${e.message}`); }
        ctx.resume();
      });
    }
    const buf = await ctx.startRendering();
    return { L: buf.getChannelData(0), R: buf.getChannelData(1), thrown };
  }

  const rmsDiff = (a, b, from, to) => {
    let s = 0, n = 0;
    for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) { const d = a[i] - b[i]; s += d * d; n++; }
    return Math.sqrt(s / Math.max(1, n));
  };
  const rms = (a, from, to) => {
    let s = 0, n = 0;
    for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) { s += a[i] * a[i]; n++; }
    return Math.sqrt(s / Math.max(1, n));
  };
  const finite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

  const clean = await live([]);
  const out = [];
  const holds = [['tap', 0.06], ['short', 0.25], ['long', 1.7]];
  for (const f of FX) {
    const p = f.zones ? 1 : null;
    for (const [name, hold] of holds) {
      const t0 = 2.013, t1 = t0 + hold;
      const r = await live([
        { t: t0, label: 'on', run: (rack, now) => rack.on(f.id, p, now) },
        { t: t1, label: 'off', run: (rack, now) => rack.off(f.id, now) },
      ]);
      // tails: reverb and delay ring on by design; everything else must be gone
      const settle = f.id === 'reverb' ? 4.5 : f.id === 'delay' ? 5 : 0.5;
      const lag = f.id === 'delay' ? 0.9 : 0.05;
      out.push({
        fx: f.id, mode: `live ${name} (${hold}s)`, thrown: r.thrown, finite: finite(r.L) && finite(r.R),
        // an echo is only heard a beat later, so listen a little past the release
        during: rmsDiff(r.L, clean.L, t0, t1 + lag) / rms(clean.L, t0, t1 + lag),
        after: rmsDiff(r.L, clean.L, t1 + settle, LEN - 0.1) / rms(clean.L, t1 + settle, LEN - 0.1),
        level: 20 * Math.log10(rms(r.L, t0 + 0.1, t1) / rms(clean.L, t0 + 0.1, t1)),
        peak: Math.max(...[r.L, r.R].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))),
      });
    }
    // twice in quick succession
    const r2 = await live([
      { t: 2.0, label: 'on', run: (rack, now) => rack.on(f.id, p, now) },
      { t: 2.1, label: 'off', run: (rack, now) => rack.off(f.id, now) },
      { t: 2.15, label: 'on', run: (rack, now) => rack.on(f.id, p, now) },
      { t: 2.4, label: 'off', run: (rack, now) => rack.off(f.id, now) },
    ]);
    const settle = f.id === 'reverb' ? 4.5 : f.id === 'delay' ? 5 : 0.5;
    out.push({
      fx: f.id, mode: 'live double tap', thrown: r2.thrown, finite: finite(r2.L),
      during: rmsDiff(r2.L, clean.L, 2.0, 2.45) / rms(clean.L, 2.0, 2.45),
      after: rmsDiff(r2.L, clean.L, 2.4 + settle, LEN - 0.1) / rms(clean.L, 2.4 + settle, LEN - 0.1),
      peak: r2.L.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
    });
  }

  // sequenced: through the real renderer, including a hit that crosses the
  // loop boundary and one that crosses a scheduling chunk
  const seq = [];
  const base = makeProject();
  const ref = await renderProject(base, { what: 'loop', passes: 3, master: false });
  for (const f of FX) {
    for (const [label, t, d] of [['mid-loop', 300, 96], ['across the loop end', 730, 80], ['one step', 480, 24]]) {
      const p = makeProject();
      p.sections[0].fx = [{ t, d, k: f.id, ...(f.zones ? { p: 1 } : {}) }];
      const r = await renderProject(p, { what: 'loop', passes: 3, master: false });
      const spt = 60 / (p.bpm * 96), a = 0.02 + t * spt, b = a + d * spt;
      const n = Math.min(r.channels[0].length, ref.channels[0].length);
      seq.push({
        fx: f.id, mode: `sequenced ${label}`, finite: finite(r.channels[0]),
        during: rmsDiff(r.channels[0], ref.channels[0], a, b + (f.id === 'delay' ? 0.9 : 0.05)) / rms(ref.channels[0], a, b + (f.id === 'delay' ? 0.9 : 0.05)),
        // the gap before the hit comes round again on the next pass
        after: f.id === 'reverb' || f.id === 'delay' ? 0
          : rmsDiff(r.channels[0], ref.channels[0], b + 0.5, a + 4 - 0.05) / rms(ref.channels[0], b + 0.5, a + 4 - 0.05),
        peak: r.channels[0].subarray(0, n).reduce((m, v) => Math.max(m, Math.abs(v)), 0),
        thrown: [],
      });
    }
  }
  return [...out, ...seq];
});

let last = '';
for (const r of results) {
  if (r.fx !== last) { console.log(r.fx); last = r.fx; }
  const level = Number.isFinite(r.level) && /long/.test(r.mode) ? `, level ${r.level >= 0 ? '+' : ''}${r.level.toFixed(1)} dB` : '';
  const tag = `${r.mode}: changes sound ${(r.during * 100).toFixed(0)}%, residue ${(r.after * 100).toFixed(2)}%, peak ${r.peak.toFixed(2)}${level}`;
  // a held effect should colour the mix, not jump out of it
  // (not Stutter, Glitch or Sleepy: their level is whatever slice they caught)
  if (level && !['tape', 'stutter', 'glitch'].includes(r.fx)) check(r.level > -4 && r.level < 4, `${r.fx}: held level stays within 4 dB of the dry mix (${r.level.toFixed(1)} dB)`);
  // Glitch picks a different trick each 16th and some steps pass straight through
  const audible = r.fx === 'glitch' || r.fx === 'squish' ? true : r.during > 0.03;
  check(r.thrown.length === 0 && r.finite && audible && r.after < 0.02 && r.peak < 4, tag + (r.thrown.length ? ' THREW ' + r.thrown.join('; ') : ''));
}
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall FX checks passed');
process.exit(failed ? 1 : 0);
