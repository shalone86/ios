// Offline rendering: turn the note data into audio, faster than real time,
// through exactly the same graph that plays live.

import { PPQ } from './theory.js';
import { getKit } from './drums.js';
import { buildGraph } from './graph.js';
import { songSegments, loopSegments, scheduleRange } from './seq.js';
import { serialize } from './state.js';
import { ensureSamples, sampleIds } from './samples.js';

const CHUNK = 1.5;      // seconds of music scheduled per step
const LEAD = 0.02;      // silence before the first note
const TAIL = 3.5;       // room for reverb and echoes to die away

// options:
//   what:      'song' | 'loop'
//   passes:    how many times to play the loop (what = 'loop')
//   seamless:  render the loop twice and keep the second pass, so the
//              tail wraps round and the file loops perfectly in a DAW
//   solo:      track id to render alone (stems)
//   master:    false to bypass the mastering EQ/compression
//   onProgress(0..1)
// Resolves to { channels: [Float32Array, Float32Array], sampleRate, seconds }.
export async function renderProject(project, options = {}) {
  const { what = 'song', sampleRate = 44100, passes = 4, seamless = false, solo = null, master = true, onProgress } = options;
  const p = JSON.parse(serialize(project));
  const useSong = what === 'song' && p.song.length > 0;
  const segs = useSong ? songSegments(p) : loopSegments(p, p.cur, seamless ? 2 : passes);
  if (!segs.length) throw new Error('Nothing to render yet');

  const spt = 60 / (p.bpm * PPQ);
  const last = segs[segs.length - 1];
  const musicSec = (last.start + last.len) * spt;
  const total = LEAD + musicSec + (seamless ? 0.01 : TAIL);
  const frames = Math.ceil(total * sampleRate);

  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const kit = await getKit(sampleRate, p.key);
  try { await ensureSamples(sampleIds(p)); } catch (e) { /* no sample storage here */ }
  const g = buildGraph(ctx, p, kit, { offline: true, solo, master });
  for (const fx of [...p.sections.flatMap((s) => s.fx), ...p.song.flatMap((b) => b.fx)]) if (fx.tr) g.trackRack(fx.tr);
  for (const k of Object.keys(p.latch || {})) if (p.latch[k]) g.rack.on(k, p.latch[k].p, 0);

  const timeAt = (tick) => LEAD + tick * spt;
  let si = 0, pos = 0;
  const scheduleUntil = (sec) => {
    const toTick = (sec - LEAD) / spt;
    while (si < segs.length && pos < toTick) {
      const seg = segs[si];
      const end = Math.min(toTick, seg.start + seg.len);
      if (end > pos) scheduleRange(g, p, seg, pos - seg.start, end - seg.start, timeAt);
      pos = Math.max(pos, end);
      if (pos >= seg.start + seg.len) si++;
    }
  };

  // Schedule one chunk ahead of the render position, pausing the render at
  // each chunk boundary. This keeps the node count small on long songs.
  scheduleUntil(CHUNK * 2);
  for (let t = CHUNK; t < total; t += CHUNK) {
    ctx.suspend(t).then(() => {
      scheduleUntil(t + CHUNK * 2);
      if (onProgress) onProgress(Math.min(1, t / total));
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  if (onProgress) onProgress(1);

  let L = buf.getChannelData(0), R = buf.getChannelData(1);
  if (seamless) {
    const one = Math.round(segs[0].len * spt * sampleRate);
    const from = Math.round(LEAD * sampleRate) + one;
    L = L.slice(from, from + one);
    R = R.slice(from, from + one);
  } else {
    // trim silence off the end, but never cut into the music itself
    const floor = Math.ceil((LEAD + musicSec) * sampleRate);
    let end = L.length - 1;
    while (end > floor && Math.abs(L[end]) < 1e-4 && Math.abs(R[end]) < 1e-4) end--;
    end = Math.min(L.length, end + Math.round(0.08 * sampleRate));
    L = L.slice(0, end);
    R = R.slice(0, end);
  }
  return { channels: [L, R], sampleRate, seconds: L.length / sampleRate };
}
