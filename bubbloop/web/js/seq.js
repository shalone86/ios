// Sequencing shared by live playback and offline export: swing, the list
// of segments a song is made of, and scheduling a slice of one segment.

import { PPQ, STEP, BAR } from './theory.js';

// Swing delays every second 16th. 0 = straight, 1 = heavy shuffle.
export function swingWarp(t, swing) {
  if (!swing) return t;
  const pair = 2 * STEP, off = swing * 0.5 * STEP;
  const base = Math.floor(t / pair) * pair, x = t - base;
  return base + (x < STEP ? (x * (STEP + off)) / STEP : STEP + off + ((x - STEP) * (STEP - off)) / STEP);
}
export function swingUnwarp(t, swing) {
  if (!swing) return t;
  const pair = 2 * STEP, off = swing * 0.5 * STEP;
  const base = Math.floor(t / pair) * pair, x = t - base;
  return base + (x < STEP + off ? (x * STEP) / (STEP + off) : STEP + ((x - STEP - off) * STEP) / (STEP - off));
}

// The last two beats of a loop, replaced by a fill: a snare-and-tom roll on
// drums, a quickening repeat of the last note on anything else.
const FILL_PADS = [2, 2, 14, 14, 13, 12, 11, 10];
export function withFill(track, evs, len) {
  const from = len - 2 * PPQ;
  const out = evs.filter((e) => e.t < from);
  let seed = null;
  for (const e of evs) if (e.t <= from) seed = e;
  seed = seed || evs[0];
  for (let i = 0; i < 8; i++) {
    const v = 0.5 + 0.06 * i;
    if (track.role === 'drums') out.push({ t: from + i * STEP, d: STEP, r: Math.floor(FILL_PADS[i] / 5), c: FILL_PADS[i] % 5, v });
    else if (seed && (i < 4 ? i % 2 === 0 : true)) out.push({ ...seed, t: from + i * STEP, d: STEP * (i < 4 ? 1.6 : 0.8), v, _p: undefined });
  }
  if (track.role === 'drums') out.push({ t: from, d: STEP, r: 0, c: 0, v: 0.9 });
  return out.sort((x, y) => x.t - y.t);
}

// A segment is one pass through one section.
// { secIdx, start, len, off, block, blockStart, pass }
export function loopSegments(project, secIdx, passes) {
  const len = project.sections[secIdx].bars * BAR;
  const out = [];
  for (let i = 0; i < passes; i++) out.push({ secIdx, start: i * len, len, off: null, block: -1, blockStart: 0, pass: i + 1 });
  return out;
}

export function songSegments(project, fromBlock = 0) {
  const out = [];
  let start = 0, pass = 1;
  project.song.forEach((b, block) => {
    if (block < fromBlock) return;
    const len = project.sections[b.sec].bars * BAR;
    const blockStart = start;
    for (let r = 0; r < b.rep; r++) {
      out.push({ secIdx: b.sec, start, len, off: b.off, block, blockStart, pass: pass++, sp: b.sp || null, last: r === b.rep - 1 });
      start += len;
    }
  });
  return out;
}

// Schedule everything in local ticks [a, b) of a segment.
//   timeAt(absTick) -> context time
//   hooks.onNote(track, ev, time), hooks.onStep(stepInSegment, time)
export function scheduleRange(g, project, seg, a, b, timeAt, hooks = {}) {
  const sec = project.sections[seg.secIdx];
  if (!sec) return;
  const spt = 60 / (project.bpm * PPQ);
  const swing = project.swing;

  for (const track of project.tracks) {
    if (seg.off && seg.off[track.id]) continue;
    let evs = sec.ev[track.id];
    if (!evs) continue;
    // "spice" set on a song block: a level change and/or a fill at the end
    const sp = seg.sp && seg.sp[track.id];
    const gain = sp && sp.vel ? sp.vel : 1;
    if (sp && sp.fill && seg.last) evs = withFill(track, evs, seg.len);
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const wt = swingWarp(ev.t, swing);
      if (wt < a) continue;
      if (wt >= b) break;
      if (ev._p === seg.pass) continue;          // just played by hand this pass
      const time = timeAt(seg.start + wt);
      g.playCell(track, ev.r, ev.c, ev.ch, Math.min(1, ev.v * gain), time, ev.d * spt, ev.a);
      if (hooks.onNote) hooks.onNote(track, ev, time);
    }
  }

  const hit = (fx, local) => {
    if (local < a || local >= b || fx._p === seg.pass) return;
    const rack = g.fxRack(fx.tr);
    if (rack) rack.on(fx.k, fx.p, timeAt(seg.start + local), Math.max(STEP / 2, fx.d) * spt);
  };
  for (const fx of sec.fx) hit(fx, fx.t);
  if (seg.block >= 0) {
    const blk = project.song[seg.block];
    const shift = seg.start - seg.blockStart;
    if (blk) for (const fx of blk.fx) hit(fx, fx.t - shift);
  }

  for (let s = Math.ceil(a / STEP); s * STEP < b; s++) {
    const time = timeAt(seg.start + s * STEP);
    g.eachRack((r) => r.tick(Math.round((seg.start + s * STEP) / STEP), time, STEP * spt));
    if (hooks.onStep) hooks.onStep(s, time);
  }
}
