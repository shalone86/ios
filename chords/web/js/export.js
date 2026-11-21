// Saving a take from Cozy Chords: the song as a WAV (with its ring-out, or
// as a clean loop), MIDI for Logic, stems for a DAW, and a Boba Beats song.

import { renderTake, performance, beatOf } from './engine.js';
import { playChord, playString, playBass, DRUMS, makeMix } from './sound.js';
import { KEY_NAMES } from './theory.js';
import { finalize } from './codec/master.js';
import { toInt } from './codec/pcm.js';
import { encodeWav } from './codec/wav.js';
import { encodeZip } from './codec/zip.js';

const SR = 44100, TARGET = -14;   // LUFS: a gentle, finished level
const slug = (s) => s.toLowerCase().replace(/♭/g, 'b').replace(/♯/g, 's').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const baseName = (take) => `cozy-chords-${slug(KEY_NAMES[take.key ?? 0])}-${take.mode || 'major'}-${take.bpm}bpm`;
const channelsOf = (buf) => [Float32Array.from(buf.getChannelData(0)), Float32Array.from(buf.getChannelData(1))];
// the take itself, plus `tail` seconds of ring-out; with no tail, the ring-out
// is folded back onto the start, so it loops without a click or a gap
function shape(chs, seconds, tail) {
  const n = Math.round(seconds * SR);
  if (!tail) for (const c of chs) for (let i = n; i < c.length; i++) c[i - n] += c[i];
  return chs.map((c) => c.slice(0, Math.min(c.length, Math.round((seconds + tail) * SR))));
}

export async function songWav(take, { tail = 3 } = {}) {
  const { buffer, seconds } = await renderTake(take, { sr: SR, tail: Math.max(3, tail) });
  const out = shape(channelsOf(buffer), seconds, tail);
  finalize(out, SR, { target: TARGET, ceilingDb: -1 });
  return encodeWav(toInt(out, 24), SR, 24);
}

// Stems: the mix, then chords, strings, bass and drums on their own, all the
// same length and level as in the mix, so they line up from bar 1 in a DAW.
export async function stemsZip(take, onStatus = () => {}) {
  onStatus('Mixing…');
  const mix = await renderTake(take, { sr: SR, tail: 3 });
  const mixChs = shape(channelsOf(mix.buffer), mix.seconds, 3);
  const { gainDb } = finalize(mixChs, SR, { target: TARGET, ceilingDb: -1 });
  const g = Math.pow(10, gainDb / 20), files = [{ name: 'mix.wav', bytes: encodeWav(toInt(mixChs, 24), SR, 24) }];
  const P = performance(take);
  const parts = [['chords', P.chords.filter((c) => !c.q)], ['strings', P.strings], ['bass', P.bass], ['drums', P.drums]].filter(([, l]) => l.length);
  for (const [k, [part]] of parts.entries()) {
    onStatus(`${part}…`);
    const { buffer } = await renderTake(take, { sr: SR, tail: 3, only: part });
    const chs = shape(channelsOf(buffer), mix.seconds, 3);
    let pk = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { c[i] *= g; pk = Math.max(pk, Math.abs(c[i])); }
    if (pk > 0.98) for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= 0.98 / pk;
    files.push({ name: `${k + 1}-${part}.wav`, bytes: encodeWav(toInt(chs, 24), SR, 24) });
  }
  return encodeZip(files.map((f) => ({ name: `${baseName(take)}/${f.name}`, bytes: f.bytes })));
}

// MIDI, 96 ticks a beat: chords, strings and bass each on a track and
// channel of their own, the drums on the drum channel (GM notes).
const GM = { kick: 36, snare: 38, rim: 37, hat: 42, shaker: 70 };
export function takeMidi(take) {
  const PPQ = 96, tick = (s) => Math.max(0, Math.round(s * take.bpm / 60 * PPQ)), P = performance(take);
  const end = tick(take.dur);
  const lanes = [
    { name: 'Cozy Chords', ch: 0, ev: P.chords.filter((c) => !c.q).flatMap((c) => c.notes.flatMap((m) => [[tick(c.t), 0x90, m, 90], [Math.max(tick(c.t) + 2, tick(c.end)), 0x80, m, 0]])) },
    { name: 'Strings', ch: 1, ev: P.strings.flatMap((s) => [[tick(s.t), 0x91, s.m, Math.round(70 + 40 * Math.min(1, s.vel) - 10)], [tick(s.t) + (s.len ? Math.max(2, tick(s.len)) : PPQ / 2), 0x81, s.m, 0]]) },
    { name: 'Bass', ch: 2, ev: P.bass.flatMap((b) => [[tick(b.t), 0x92, b.m, 95], [Math.max(tick(b.t) + 2, tick(b.t + b.len)), 0x82, b.m, 0]]) },
    { name: `Drums (${beatOf(take.beat).name})`, ch: 9, ev: P.drums.flatMap((d) => [[tick(d.t), 0x99, GM[d.kind], Math.round(100 * d.vel)], [tick(d.t) + PPQ / 8, 0x89, GM[d.kind], 0]]) },
  ].filter((l) => l.ev.length);
  const chunk = (bytes) => [0x4d, 0x54, 0x72, 0x6b, (bytes.length >>> 24) & 255, (bytes.length >> 16) & 255, (bytes.length >> 8) & 255, bytes.length & 255, ...bytes];
  const track = (lane, first) => {
    const ev = lane.ev.sort((a, b) => a[0] - b[0] || ((a[1] & 0xf0) === 0x80 ? -1 : 1)), bytes = [];
    const vlq = (v) => { const o = [v & 0x7f]; while ((v >>= 7)) o.unshift((v & 0x7f) | 0x80); bytes.push(...o); };
    const name = new TextEncoder().encode(lane.name);
    vlq(0); bytes.push(0xff, 0x03, name.length, ...name);
    if (first) {
      const tempo = Math.round(60000000 / take.bpm), waltz = beatOf(take.beat).steps === 12;
      vlq(0); bytes.push(0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
      vlq(0); bytes.push(0xff, 0x58, 0x04, waltz ? 3 : 4, 2, 24, 8);
    }
    let last = 0;
    for (const [t, st, a, b] of ev) { vlq(t - last); last = t; bytes.push(st, a, b); }
    vlq(Math.max(0, end - last)); bytes.push(0xff, 0x2f, 0x00);
    return chunk(bytes);
  };
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, lanes.length, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...head, ...lanes.flatMap((l, k) => track(l, k === 0))]);
}

// Hand a file over: a phone browser offers the share sheet, a computer downloads it.
export async function deliver(bytes, name, mime) {
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return 'Shared'; } catch (e) { if (e.name === 'AbortError') return ''; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'Downloaded';
}

// ---------- handing the take to Boba Beats ----------
// Boba builds its chords from its own scale grid, which cannot hold every
// chord here (a ♭VII, a borrowed iv). So, like Pop Pads' drums, each sound
// goes across as a sample: a Boba sampler track each for the chords (one
// bubble per chord), the strings and the bass (one bubble per note, low to
// high), and the drums; the take becomes Boba's song, cut into its loops.
const B_PPQ = 96, B_BAR = 384, B_COLS = 5;
const bid = () => Math.random().toString(36).slice(2, 10);

// one sound, alone, as a mono one-shot (with the room it has in the mix)
async function oneShot(play, secs) {
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * SR), SR), mix = makeMix(ctx);
  play(ctx, mix);
  const b = await ctx.startRendering(), L = b.getChannelData(0), R = b.getChannelData(1), mono = new Float32Array(L.length);
  let end = 0;
  for (let i = 0; i < L.length; i++) { mono[i] = (L[i] + R[i]) / 2; if (Math.abs(mono[i]) > 0.0005) end = i; }
  const n = Math.min(mono.length, end + Math.round(SR * 0.02)), data = mono.slice(0, n);
  for (let i = Math.max(0, n - 200); i < n; i++) data[i] *= (n - i) / 200;
  return data;
}
// all the sounds raised together until the loudest peaks at Boba's 90%, so the balance holds
function pack(sounds) {
  let top = 0; for (const s of sounds) for (const v of s.data) top = Math.max(top, Math.abs(v));
  const g = top > 0 ? 0.9 / top : 1;
  return sounds.map((s) => {
    const pcm = new Int16Array(s.data.length);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s.data[i] * g * 32767)));
    const bytes = new Uint8Array(pcm.buffer); let str = '';
    for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { name: s.name, root: 60, pitched: false, sr: SR, pcm: btoa(str) };
  });
}

export async function bobaSong(take) {
  const P = performance(take), ticks = (s) => Math.round(s * take.bpm / 60 * B_PPQ);
  const lanes = [];   // { role, name, sounds: [{ key, name, data }], hits: [{ t, d, key, v }] }
  // the chords: one bubble per chord, as long as it was usually held
  // (an auto-style's chords are left out: their notes come across as strings)
  P.chords = P.chords.filter((c) => !c.q);
  if (P.chords.length) {
    const keys = [...new Set(P.chords.map((c) => `${c.label}|${c.v}`))].slice(0, 25);
    const sounds = [];
    for (const key of keys) {
      const c = P.chords.find((x) => `${x.label}|${x.v}` === key), held = Math.min(3, Math.max(0.6, c.end - c.t));
      sounds.push({ key, name: c.label, data: await oneShot((ctx, mix) => playChord(ctx, mix.voices, 0, c.v, c.notes).release(held), held + 2.2) });
    }
    lanes.push({ role: 'pads', name: 'Cozy Chords', sounds, hits: P.chords.map((c) => ({ t: c.t, d: c.end - c.t, key: `${c.label}|${c.v}` })) });
  }
  // the strings and the bass: one bubble per note, low to high
  const notes = async (list, role, name, make) => {
    if (!list.length) return;
    const ms = [...new Set(list.map((x) => x.m))].sort((a, b) => a - b).slice(0, 25), sounds = [];
    for (const m of ms) sounds.push({ key: m, name: `${name} ${m}`, data: await oneShot((ctx, mix) => make(ctx, mix, m), 2.6) });
    lanes.push({ role, name, sounds, hits: list.filter((x) => ms.includes(x.m)).map((x) => ({ t: x.t, d: x.len || 0.25, key: x.m, v: x.vel })) });
  };
  await notes(P.strings, 'melody', 'Cozy Strings', (ctx, mix, m) => playString(ctx, mix.voices, 0, P.strings.find((s) => s.m === m).v, m));
  await notes(P.bass, 'bass', 'Cozy Bass', (ctx, mix, m) => playBass(ctx, mix.bass, 0, m, 0.5));
  if (P.drums.length) {
    const kinds = [...new Set(P.drums.map((d) => d.kind))], sounds = [];
    for (const k of kinds) sounds.push({ key: k, name: k, data: await oneShot((ctx, mix) => DRUMS[k](ctx, mix.drums, 0), 0.8) });
    lanes.push({ role: 'drums', name: 'Cozy Beat', sounds, hits: P.drums.map((d) => ({ t: d.t, d: 0.1, key: d.kind, v: d.vel })) });
  }
  // every sound, levelled together
  const all = lanes.flatMap((l) => l.sounds), packed = pack(all), samples = {};
  const track = (role, name, kit) => ({ id: bid(), role, name, inst: 'sampler', vol: 0.9, pan: 0, oct: 0, rev: 0, dly: 0, chord: 'off', smp: { mode: 'kit', key: null, kit } });
  let k = 0;
  const tracks = lanes.map((l) => {
    const kit = {};
    l.sounds.forEach((s, slot) => { const id = 's' + bid(); samples[id] = packed[k++]; kit[slot] = id; s.slot = slot; });
    return track(l.role, l.name, kit);
  });
  // the take, cut into Boba's loops: 8 bars at a time, the last one as short as fits
  const total = ticks(take.dur), sections = [], blocks = [];
  for (let at = 0; at < total && sections.length < 8;) {
    const left = Math.ceil((total - at) / B_BAR), bars = [8, 4, 2, 1].find((b) => b <= left) || 1, len = bars * B_BAR;
    const ev = Object.fromEntries(tracks.map((t) => [t.id, []]));
    lanes.forEach((l, li) => {
      for (const h of l.hits) {
        const t = ticks(h.t) - at; if (t < 0 || t >= len) continue;
        const slot = l.sounds.find((s) => s.key === h.key).slot;
        ev[tracks[li].id].push({ t, d: Math.max(4, Math.min(len - t, ticks(h.d))), r: Math.floor(slot / B_COLS), c: slot % B_COLS, v: Math.min(1, 0.85 * (h.v || 1)) });
      }
    });
    for (const list of Object.values(ev)) list.sort((a, b) => a.t - b.t);
    blocks.push({ sec: sections.length, rep: 1, off: {}, fx: [] });
    sections.push({ bars, ev, fx: [], mute: {} });
    at += len;
  }
  const now = Date.now();
  return {
    v: 1, id: bid(), name: `Cozy Chords in ${KEY_NAMES[take.key ?? 0]} ${take.mode || 'major'}`, created: now, modified: now,
    bpm: take.bpm, swing: beatOf(take.beat).swing ? 0.3 : 0, key: take.key ?? 0, scale: take.mode === 'minor' ? 'minor' : 'major', quant: B_PPQ / 4, metro: false, master: 'cozy',
    tracks, sections, cur: 0, song: sections.length > 1 ? blocks : [], latch: {}, space: { rev: 'hall', dly: 'ping' },
    samples,
  };
}

// The website: the apps share this site's storage, so the song waits in
// IndexedDB and Boba picks it up when it opens with ?from=chords.
export function handOff(file) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bubble-handoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('songs');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('songs', 'readwrite');
      tx.objectStore('songs').put({ file, at: Date.now() }, 'chords');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
