// The sampler's sample library. Audio you record or import is trimmed,
// levelled, pitch-detected and kept in IndexedDB on the device; songs refer
// to samples by id. Decoded buffers are cached so playback is instant and the
// offline renderer can use the very same audio.

import { ROWS, COLS, cellNotes } from './theory.js';
import { chordOf } from './state.js';

const DB = 'bubbloop-samples', STORE = 'samples';
const cache = new Map();          // id -> { id, name, root, buffer }
export const MAX_SECONDS = 12;

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

function toBuffer(data, sr) {
  const b = new AudioBuffer({ length: Math.max(1, data.length), sampleRate: sr, numberOfChannels: 1 });
  b.copyToChannel(data, 0);
  return b;
}

// Cut the lead-in and tail off a recording, fade the edges, bring the peak
// up to a set level. A phone microphone is never silent (room hum, hiss), so
// "silence" is judged against this recording's own noise floor: the sound
// starts at the first moment clearly above it, minus a few milliseconds so
// the attack keeps its edge.
export function tidy(data, sr) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak < 1e-4) return null;
  const hop = Math.max(1, Math.floor(sr * 0.005)), frames = Math.ceil(data.length / hop);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0, n = 0;
    for (let i = f * hop; i < Math.min(data.length, (f + 1) * hop); i++, n++) e += data[i] * data[i];
    rms[f] = Math.sqrt(e / Math.max(1, n));
  }
  const sorted = Float32Array.from(rms).sort();
  const loud = sorted[frames - 1];
  // the quietest tenth is the noise, unless the sound never goes quiet (a held note)
  const noise = Math.min(sorted[Math.floor(frames * 0.1)], loud * 0.03);
  // the sound starts ~10 dB over the noise, or 26 dB under the loudest moment if that is higher
  const startAt = Math.max(noise * 3.2, loud * 0.05), endAt = Math.max(noise * 2, loud * 0.012);
  let fa = 0, fb = frames - 1;
  while (fa < fb && rms[fa] < startAt) fa++;
  while (fb > fa && rms[fb] < endAt) fb--;
  const a = Math.max(0, fa * hop - Math.floor(sr * 0.008));
  const b = Math.min(data.length - 1, (fb + 1) * hop + Math.floor(sr * 0.06));
  const n = Math.min(b - a + 1, Math.floor(sr * MAX_SECONDS));
  const out = new Float32Array(n);
  const k = 0.9 / peak, fin = Math.floor(sr * 0.003), fout = Math.floor(sr * 0.04);
  for (let i = 0; i < n; i++) {
    let g = k;
    if (i < fin) g *= i / fin;
    if (n - i < fout) g *= (n - i) / fout;
    out[i] = data[a + i] * g;
  }
  return out;
}

// Fundamental as a (fractional) MIDI note, by autocorrelation of the body of
// the sound. Returns null when it is not pitched (a drum hit, a noise).
export function detectPitch(data, sr) {
  const n = Math.min(data.length, 8192);
  if (n < 2048) return null;
  const start = Math.min(data.length - n, Math.floor(data.length * 0.15));
  const x = data.subarray(start, start + n);
  const lo = Math.floor(sr / 1000), hi = Math.min(Math.floor(sr / 55), n >> 1);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  if (energy < 1e-6) return null;
  const ac = new Float32Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s / energy;
  }
  // first strong peak, not the tallest: the tallest is often an octave below
  let best = -1, top = 0;
  for (let lag = lo; lag <= hi; lag++) top = Math.max(top, ac[lag]);
  if (top < 0.45) return null;
  for (let lag = lo; lag <= hi; lag++) {
    if (ac[lag] > top * 0.88 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { best = lag; break; }
  }
  if (best < 0) return null;
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const shift = (y0 - 2 * y1 + y2) !== 0 ? 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
  const freq = sr / (best + shift);
  return 69 + 12 * Math.log2(freq / 440);
}

const newId = () => 's' + Math.random().toString(36).slice(2, 10);

// Store a sound. Resolves to its record, or null if it was silent.
export async function addSample(raw, sr, name) {
  const data = tidy(raw, sr);
  if (!data) return null;
  const pitch = detectPitch(data, sr);
  const rec = { id: newId(), name: name || 'Sample', sr, data, root: pitch == null ? 60 : pitch, pitched: pitch != null, made: Date.now() };
  await tx('readwrite', (s) => s.put(rec));
  cache.set(rec.id, { id: rec.id, name: rec.name, root: rec.root, pitched: rec.pitched, buffer: toBuffer(data, sr) });
  return cache.get(rec.id);
}

export const getSample = (id) => cache.get(id) || null;

// Make sure these ids are decoded and ready (before playing or rendering).
export async function ensureSamples(ids) {
  const need = [...new Set(ids)].filter((id) => id && !cache.has(id));
  if (!need.length) return;
  const d = await db();
  await Promise.all(need.map((id) => new Promise((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => {
      const r = req.result;
      if (r) cache.set(id, { id, name: r.name, root: r.root, pitched: r.pitched, buffer: toBuffer(r.data, r.sr) });
      resolve();
    };
    req.onerror = () => resolve();
  })));
}

export async function setRoot(id, root) {
  const c = cache.get(id);
  if (!c) return;
  c.root = root;
  const d = await db();
  const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
  const req = store.get(id);
  req.onsuccess = () => { if (req.result) { req.result.root = root; store.put(req.result); } };
}

// Every sample id a project uses.
export function sampleIds(project) {
  const ids = [];
  for (const t of project.tracks) {
    if (!t.smp) continue;
    if (t.smp.key) ids.push(t.smp.key);
    for (const id of Object.values(t.smp.kit || {})) ids.push(id);
  }
  return [...new Set(ids)];
}

// For song files: samples travel with the song as 16-bit audio in base64.
export async function packSamples(ids) {
  await ensureSamples(ids);
  const out = {};
  for (const id of ids) {
    const c = cache.get(id);
    if (!c) continue;
    const f = c.buffer.getChannelData(0);
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    const bytes = new Uint8Array(pcm.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    out[id] = { name: c.name, root: c.root, pitched: c.pitched, sr: c.buffer.sampleRate, pcm: btoa(s) };
  }
  return out;
}

export async function unpackSamples(packed) {
  for (const [id, r] of Object.entries(packed || {})) {
    if (cache.has(id)) continue;
    const bin = atob(r.pcm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const data = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
    await tx('readwrite', (s) => s.put({ id, name: r.name, sr: r.sr, data, root: r.root, pitched: r.pitched, made: Date.now() }));
    cache.set(id, { id, name: r.name, root: r.root, pitched: r.pitched, buffer: toBuffer(data, r.sr) });
  }
}

// ---------- natural pitch (formants kept) ----------
// In keyboard mode each note the song can play is prepared ahead of time by
// a background worker and kept here. Until a note is ready the sampler plays
// it the old way (sped up or slowed down), so nothing ever waits.

const shifted = new Map();        // key -> AudioBuffer
const queued = new Set();         // keys a worker is busy with
let worker = null, jobN = 0, busy = 0;
const waiters = new Set();        // resolve functions waiting for the queue to drain

const noteKey = (s, m, formant) => `${s.id}|${s.root.toFixed(3)}|${m}|${formant}`;

export function naturalBuffer(sample, m, formant = 0) {
  return shifted.get(noteKey(sample, m, formant)) || null;
}

function settle() {
  if (busy > 0) return;
  for (const w of waiters) w();
  waiters.clear();
}

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./dsp/shift-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, out, done, error } = e.data;
      if (out) {
        const b = new AudioBuffer({ length: Math.max(1, out.length), sampleRate: pending.get(id) || 44100, numberOfChannels: 1 });
        b.copyToChannel(out, 0);
        shifted.set(id, b);
        queued.delete(id);
        pending.delete(id);
      }
      if (done || error) { busy--; settle(); }
    };
    worker.onerror = () => { worker = false; busy = 0; queued.clear(); settle(); };
  } catch (e) {
    worker = false;               // no module workers here: keep the old way
  }
  return worker;
}
const pending = new Map();        // key -> sample rate, for jobs in flight

// Every note a keyboard-mode sampler track could play: each bubble with its
// chord, a semitone either side (accidentals), and anything already recorded.
function wantedNotes(project, track) {
  const want = new Map();         // midi -> priority (lower first)
  const add = (list, pri) => { for (const m of list) if (!want.has(m) || want.get(m) > pri) want.set(m, pri); };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      add(cellNotes(project, track, r, c, 'off', 0), 0);
      add(cellNotes(project, track, r, c, chordOf(track, c), 0), 1);
      add(cellNotes(project, track, r, c, 'off', 1), 2);
      add(cellNotes(project, track, r, c, 'off', -1), 2);
    }
  }
  for (const sec of project.sections) {
    for (const e of sec.ev[track.id] || []) add(cellNotes(project, track, e.r, e.c, e.ch, e.a), 0);
  }
  return [...want.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
}

// Make sure every note the project needs is prepared (or on its way).
// Resolves when the queue is empty. evict: drop notes no longer needed.
export function prepareNatural(project, { evict = false } = {}) {
  const keep = new Set();
  const jobs = new Map();         // sample id -> { sample, notes: [] }
  for (const t of project.tracks) {
    const smp = t.smp;
    if (t.inst !== 'sampler' || !smp || smp.mode === 'kit' || smp.shift === 'classic' || !smp.key) continue;
    const sample = cache.get(smp.key);
    if (!sample) continue;
    const formant = smp.formant || 0;
    for (const m of wantedNotes(project, t)) {
      const key = noteKey(sample, m, formant);
      keep.add(key);
      if (shifted.has(key) || queued.has(key)) continue;
      const semis = m - sample.root;
      if (Math.abs(semis) < 0.02 && formant === 0) continue;       // already the right note
      const j = jobs.get(sample.id) || { sample, notes: [] };
      j.notes.push({ id: key, semis, formant });
      jobs.set(sample.id, j);
    }
  }
  if (evict) for (const k of [...shifted.keys()]) if (!keep.has(k)) shifted.delete(k);
  const w = jobs.size ? getWorker() : null;
  if (w) {
    for (const { sample, notes } of jobs.values()) {
      const data = sample.buffer.getChannelData(0).slice();
      for (const n of notes) { queued.add(n.id); pending.set(n.id, sample.buffer.sampleRate); }
      busy++;
      const f0 = sample.pitched ? 440 * Math.pow(2, (sample.root - 69) / 12) : 0;
      w.postMessage({ job: ++jobN, key: `${sample.id}|${sample.root.toFixed(3)}`, data, sr: sample.buffer.sampleRate, f0, notes }, [data.buffer]);
    }
  }
  return busy > 0 ? new Promise((resolve) => waiters.add(resolve)) : Promise.resolve();
}

// ---------- chopping ----------

// Cut a recording into separate hits for kit mode: wherever the sound
// suddenly gets louder (most of all in its brighter part, where attacks
// live) a new slice starts. A sound with few hits, like a held chord, is
// cut into even pieces instead. Returns up to `max` slices.
export function chop(data, sr, max = 25) {
  const hop = 512, frames = Math.floor(data.length / hop);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) { const d = data[i] - prev; prev = data[i]; e += d * d + 0.25 * data[i] * data[i]; }
    env[f] = Math.log(e / hop + 1e-10);
  }
  const flux = new Float32Array(frames);
  for (let f = 3; f < frames; f++) flux[f] = Math.max(0, env[f] - (env[f - 1] + env[f - 2] + env[f - 3]) / 3);
  let mean = 0, sd = 0;
  for (const v of flux) mean += v / frames;
  for (const v of flux) sd += (v - mean) ** 2 / frames;
  sd = Math.sqrt(sd);
  const gap = Math.ceil(0.09 * sr / hop);
  let peak = -1e9;
  for (const v of env) peak = Math.max(peak, v);
  let hits = [];
  for (let f = 3; f < frames - 1; f++) {
    // a hit is a real jump: above the usual wobble and at least ~4 dB
    if (flux[f] < Math.max(mean + 1.5 * sd, 1) || flux[f] < flux[f - 1] || flux[f] < flux[f + 1] || env[f] < peak - 9) continue;
    if (hits.length && f - hits[hits.length - 1].f < gap) {
      if (flux[f] > hits[hits.length - 1].s) hits[hits.length - 1] = { f, s: flux[f] };
      continue;
    }
    hits.push({ f, s: flux[f] });
  }
  // the first sound always starts a slice
  let first = 0;
  while (first < frames && env[first] < peak - 9) first++;
  if (!hits.length || hits[0].f - first > gap) hits.unshift({ f: first, s: Infinity });
  if (hits.length > max) hits = hits.sort((a, b) => b.s - a.s).slice(0, max).sort((a, b) => a.f - b.f);
  let starts = hits.map((h) => Math.max(0, h.f * hop - 256));
  // few hits in a long sound: even pieces instead
  if (starts.length < 4 && data.length > sr * 2) {
    const pieces = Math.min(max, 8), len = data.length / pieces;
    starts = Array.from({ length: pieces }, (_, i) => Math.floor(i * len));
  }
  return starts.map((a, i) => data.slice(a, Math.min(starts[i + 1] || data.length, a + sr * 3)));
}

// ---------- getting sound in ----------

// Start recording from the microphone. Resolves to { stop, level } where
// stop() resolves to { data, sr } and level() is the current input level 0..1.
export async function recordMic(ctx) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const src = ctx.createMediaStreamSource(stream);
  const tap = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const chunks = [];
  let total = 0, lvl = 0;
  const limit = ctx.sampleRate * MAX_SECONDS;
  tap.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    let p = 0;
    for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
    lvl = p;
    if (total < limit) { chunks.push(new Float32Array(d)); total += d.length; }
  };
  src.connect(tap).connect(mute).connect(ctx.destination);
  return {
    level: () => lvl,
    full: () => total >= limit,
    stop() {
      tap.onaudioprocess = null;
      try { src.disconnect(); tap.disconnect(); mute.disconnect(); } catch (e) { /* gone */ }
      stream.getTracks().forEach((t) => t.stop());
      const data = new Float32Array(total);
      let o = 0;
      for (const c of chunks) { data.set(c, o); o += c.length; }
      return { data, sr: ctx.sampleRate };
    },
  };
}

// Decode an audio file the user picked, mixed to mono.
export async function decodeFile(ctx, file) {
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const n = Math.min(buf.length, Math.floor(buf.sampleRate * MAX_SECONDS * 2));
  const data = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) data[i] += ch[i] / buf.numberOfChannels;
  }
  return { data, sr: buf.sampleRate };
}
