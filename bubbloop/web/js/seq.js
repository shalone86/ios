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

// Fills rework the last two beats of a loop out of what is already there,
// so they work the same on any track:
//   rep8 / rep16  the first slice (an 8th or a 16th) repeats to the end
//   stutter       the last beat retriggers in 32nds
//   jumble        the 16th-note slices are played in a shuffled order
export const FILLS = [['rep8', 'Repeat'], ['rep16', 'Repeat fast'], ['stutter', 'Stutter'], ['jumble', 'Jumble']];
const JUMBLE = [3, 1, 6, 0, 5, 2, 7, 4];
export function withFill(track, evs, len, kind) {
  if (kind === true) kind = 'rep8';
  const from = kind === 'stutter' ? len - PPQ : len - 2 * PPQ;
  const keep = evs.filter((e) => e.t < from);
  const inside = evs.filter((e) => e.t >= from);
  const out = keep.slice();
  if (kind === 'jumble') {
    for (const e of inside) {
      const slot = Math.floor((e.t - from) / STEP);
      out.push({ ...e, t: from + JUMBLE.indexOf(slot) * STEP + ((e.t - from) % STEP), d: Math.min(e.d, STEP), _p: undefined });
    }
    return out.sort((x, y) => x.t - y.t);
  }
  const L = kind === 'rep16' ? STEP : kind === 'stutter' ? STEP / 2 : STEP * 2;
  let src = inside.filter((e) => e.t < from + L).map((e) => ({ ...e, t: e.t - from }));
  if (!src.length) {
    const seed = keep[keep.length - 1] || evs[0];
    if (!seed) return evs;
    src = [{ ...seed, t: 0 }];
  }
  const n = Math.round((len - from) / L);
  for (let i = 0; i < n; i++) {
    for (const e of src) out.push({ ...e, t: from + i * L + e.t, d: Math.min(e.d, L * 0.9), v: Math.min(1, e.v * (0.6 + 0.4 * (i + 1) / n)), _p: undefined });
  }
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
    if (sp && sp.fill && seg.last) evs = withFill(track, evs, seg.len, sp.fill);
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
