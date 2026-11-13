// Instrument pack: every track's sound sampled note by note, with an .sfz
// map per track, bundled into one ZIP for a DAW sampler.

import { makeShared, makeInsert, startVoice, instrumentById } from '../instruments.js';
import { getKit, DRUM_PADS } from '../drums.js';
import { rootMidi } from '../theory.js';
import { toInt } from './pcm.js';
import { encodeWav } from './wav.js';
import { encodeZip } from './zip.js';

const SR = 44100;
const HOLD = 2;            // seconds a note is held before its release
const RENDER = 7;          // room for the longest release tail
const STEP = 3;            // semitones between sampled notes
const LOW = 24, HIGH = 108;
const TRIM = 1e-4;         // tails below this (-80 dB) are cut off
const PEAK = 0.9;

const safe = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Track';
const pad3 = (n) => String(n).padStart(3, '0');

// The notes sampled for a track, lowest first.
export function sampleNotes(project, track) {
  const lo = Math.max(LOW, rootMidi(project, track));
  const hi = Math.min(HIGH, rootMidi(project, track) + 60);
  const notes = [];
  for (let m = lo; m <= hi; m += STEP) notes.push(m);
  if (notes[notes.length - 1] < hi - 1) notes.push(hi);
  return notes;
}

// One note through the track's insert, dry. Resolves to [L, R] Float32Arrays.
async function renderNote(inst, midi) {
  const ctx = new OfflineAudioContext(2, Math.ceil(RENDER * SR), SR);
  const sh = makeShared(ctx);
  const ins = makeInsert(ctx, sh, inst.id);
  const bus = ctx.createGain();
  if (ins) { bus.connect(ins.input); ins.output.connect(ctx.destination); } else bus.connect(ctx.destination);
  startVoice(ctx, sh, inst, bus, midi, 1, 0.01, HOLD);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

// Cut the silent end off, with a short fade so the cut never clicks.
function trim(chs) {
  let last = 0;
  for (const d of chs) for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > TRIM) { last = i; break; }
  const end = Math.min(chs[0].length, Math.max(Math.round(0.3 * SR), last + Math.round(0.05 * SR)));
  const fade = Math.round(0.02 * SR);
  return chs.map((d) => {
    const o = d.slice(0, end);
    for (let i = 0; i < fade; i++) o[end - 1 - i] *= i / fade;
    return o;
  });
}

const peakOf = (chs) => {
  let p = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
};

// Mono when the two sides match, otherwise stereo; scaled by k.
function wavBytes(chs, k = 1) {
  let diff = 0;
  for (let i = 0; i < chs[0].length; i++) diff = Math.max(diff, Math.abs(chs[0][i] - chs[1][i]));
  const use = diff < 1e-5 ? [chs[0]] : chs;
  const scaled = use.map((d) => d.map((x) => x * k));
  return encodeWav(toInt(scaled, 16), SR, 16);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Resolves to { name, bytes, files } where files lists every path in the zip.
// onStatus(label, fraction) as work moves along.
export async function buildPack(project, onStatus = () => {}) {
  const files = [];
  const tracks = project.tracks;
  const kit = tracks.some((t) => t.role === 'drums' || t.inst === 'drums') ? await getKit(SR, project.key) : null;

  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti];
    const dir = `${String(ti + 1).padStart(2, '0')} ${safe(track.name)}`;
    const frac = (v) => (ti + v) / tracks.length;
    const label = `Sampling ${track.name}`;
    onStatus(label, frac(0));
    if (track.inst === 'sampler') continue;       // already your own audio; nothing to sample

    if (track.role === 'drums' || track.inst === 'drums') {
      const seen = new Set();
      const lines = ['// Boba Beats drums: one pad per key, played in full.', '<group> loop_mode=one_shot ampeg_release=0.02'];
      DRUM_PADS.forEach((pad, i) => {
        if (seen.has(pad.gm)) return;
        seen.add(pad.gm);
        const b = kit.buffers[i];
        const chs = [b.getChannelData(0), b.getChannelData(Math.min(1, b.numberOfChannels - 1))];
        const k = Math.min(1, 0.98 / (peakOf(chs) || 1));
        const file = `${pad.id}.wav`;
        files.push({ name: `${dir}/${file}`, bytes: wavBytes(chs, k) });
        lines.push(`// ${pad.name}`, `<region> sample=${file} key=${pad.gm}`);
      });
      files.push({ name: `${dir}/${safe(track.name)}.sfz`, bytes: new TextEncoder().encode(lines.join('\n') + '\n') });
      continue;
    }

    const inst = instrumentById(track.inst);
    const notes = sampleNotes(project, track);
    const takes = [];
    for (let i = 0; i < notes.length; i++) {
      takes.push(trim(await renderNote(inst, notes[i])));
      onStatus(label, frac((i + 1) / notes.length));
      await tick();
    }
    // one gain for the whole track keeps the notes' levels in proportion
    const k = PEAK / (Math.max(...takes.map(peakOf)) || 1);
    const lines = [`// Boba Beats ${inst.name}: a sample every ${STEP} semitones.`, '<group> loop_mode=no_loop ampeg_release=0.4'];
    notes.forEach((m, i) => {
      const file = `${pad3(m)}.wav`;
      files.push({ name: `${dir}/${file}`, bytes: wavBytes(takes[i], k) });
      const lo = i === 0 ? m : Math.floor((notes[i - 1] + m) / 2) + 1;
      const hi = i === notes.length - 1 ? m : Math.floor((m + notes[i + 1]) / 2);
      lines.push(`<region> sample=${file} pitch_keycenter=${m} lokey=${lo} hikey=${hi}`);
    });
    files.push({ name: `${dir}/${safe(track.name)}.sfz`, bytes: new TextEncoder().encode(lines.join('\n') + '\n') });
  }

  onStatus('Zipping', 0.97);
  const bytes = encodeZip(files);
  return { name: `${safe(project.name)} instruments.zip`, bytes, files: files.map((f) => f.name) };
}
