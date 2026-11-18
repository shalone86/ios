// Saving beats out of Pop Pads: the loop as a WAV, the pattern as MIDI (it
// lands on the right drums in Logic's Drum Kit Designer or any GM kit), and
// every sound on its own (stems) so a DAW can mix them.

import { renderSong, STEPS, padAt as padSettings } from './engine.js';
import { KITS } from './kits.js';
import { finalize } from './codec/master.js';
import { toInt } from './codec/pcm.js';
import { encodeWav } from './codec/wav.js';
import { encodeZip } from './codec/zip.js';

const TARGET = -12;   // LUFS: about as loud as a finished beat, with a clean ceiling
const SR = 44100;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const baseName = (song) => `pop-pads-${slug(KITS[song.kit].name)}-${song.bpm}bpm`;
const channelsOf = (buf) => [Float32Array.from(buf.getChannelData(0)), Float32Array.from(buf.getChannelData(1))];
// trim the render to the loop itself, plus `tail` seconds of ring-out
const cut = (chs, seconds, tail) => chs.map((c) => c.slice(0, Math.min(c.length, Math.round((seconds + tail) * SR))));

export async function loopWav(song, { loops = 2, tail = 0 } = {}) {
  const { buffer, seconds } = await renderSong(song, { loops, sr: SR, tail: Math.max(2, tail) });
  // a loop that repeats cleanly: the ring-out from the end is folded back onto the start
  const chs = channelsOf(buffer), n = Math.round(seconds * SR);
  if (!tail) for (const c of chs) { for (let i = n; i < c.length; i++) c[i - n] += c[i]; }
  const out = cut(chs, seconds, tail);
  const stats = finalize(out, SR, { target: TARGET, ceilingDb: -1 });
  return { bytes: encodeWav(toInt(out, 24), SR, 24), stats };
}

export async function stemsZip(song, { loops = 1 } = {}, onStatus = () => {}) {
  // the mix first, to learn how much gain the master adds; each stem gets the same
  onStatus('Mixing…');
  const mix = await renderSong(song, { loops, sr: SR });
  const n = Math.round(mix.seconds * SR);
  const wrap = (chs) => { for (const c of chs) for (let i = n; i < c.length; i++) c[i - n] += c[i]; return cut(chs, mix.seconds, 0); };
  const mixChs = wrap(channelsOf(mix.buffer));
  const { gainDb } = finalize(mixChs, SR, { target: TARGET, ceilingDb: -1 });
  const g = Math.pow(10, gainDb / 20);
  const files = [{ name: 'mix.wav', bytes: encodeWav(toInt(mixChs, 24), SR, 24) }];
  const bars = song.chain.length > 1 ? song.chain : [song.cur];
  const used = [...Array(16).keys()].filter((i) => bars.some((b) => song.patterns[b][i]));
  for (const i of used) {
    onStatus(`${KITS[song.kit].pads[i].name}…`);
    const { buffer } = await renderSong(song, { loops, solo: i, sr: SR });
    const chs = wrap(channelsOf(buffer));
    let pk = 0; for (const c of chs) for (let k = 0; k < c.length; k++) { c[k] *= g; pk = Math.max(pk, Math.abs(c[k])); }
    if (pk > 0.98) for (const c of chs) for (let k = 0; k < c.length; k++) c[k] *= 0.98 / pk;
    files.push({ name: `${String(i + 1).padStart(2, '0')}-${slug(KITS[song.kit].pads[i].name)}.wav`, bytes: encodeWav(toInt(chs, 24), SR, 24) });
  }
  return encodeZip(files.map((f) => ({ name: `${baseName(song)}/${f.name}`, bytes: f.bytes })));
}

// A standard MIDI file, 96 ticks a beat: the drums on the drum channel (GM
// notes, so they land on the right drums in Logic), and the bass, chords and
// lead each on a track of their own, with their real notes.
export function patternMidi(song, { loops = 1 } = {}) {
  const PPQ = 96, tps = PPQ / 4, bars = song.chain.length > 1 ? song.chain : [song.cur];
  const pads = KITS[song.kit].pads, swingTicks = Math.round(song.swing * tps * 0.66);
  const midiOf = (f) => Math.round(69 + 12 * Math.log2(f / 440));
  const lanes = { drums: { name: `Pop Pads ${KITS[song.kit].name}`, ch: 9, ev: [] } };
  const CH = { bass: 0, chord: 1, lead: 2 };
  for (let b = 0; b < bars.length * loops; b++) {
    const pi = bars[b % bars.length], pat = song.patterns[pi];
    for (let s = 0; s < STEPS; s++) {
      const at = (b * STEPS + s) * tps + (s % 2 ? swingTicks : 0);
      for (let i = 0; i < 16; i++) if ((pat[i] >> s) & 1) {
        // nudges and repeats come along, so the MIDI plays like the app
        const pad = pads[i], tw = padSettings(song, pi, i, s);
        let lane = lanes.drums, notes = [pad.gm], len = (k) => Math.max(2, Math.round((tps / k) * 0.9));
        if (pad.tone) {
          lane = lanes[pad.tone] = lanes[pad.tone] || { name: pad.name, ch: CH[pad.tone], ev: [] };
          const root = midiOf(pad.params.f) + Math.round(tw.pitch || 0);
          notes = (pad.params.notes || [0]).map((n) => root + n).filter((n) => n >= 0 && n < 128);
          len = () => Math.max(2, Math.round(tps * Math.max(0.25, tw.len || 1)) - 1);
        }
        const k = Math.max(1, Math.min(4, Math.round(tw.rep || 1))), t0 = Math.max(0, at + Math.round((tw.nudge || 0) * tps));
        for (let j = 0; j < k; j++) {
          const t = t0 + Math.round((j * tps) / k);
          for (const note of notes) lane.ev.push([t, 0x90 | lane.ch, note, j ? 80 : 100], [t + len(k), 0x80 | lane.ch, note, 0]);
        }
      }
    }
  }
  const end = bars.length * loops * STEPS * tps;
  const chunk = (bytes) => [0x4d, 0x54, 0x72, 0x6b, (bytes.length >>> 24) & 255, (bytes.length >> 16) & 255, (bytes.length >> 8) & 255, bytes.length & 255, ...bytes];
  const trackBytes = (lane, first) => {
    const ev = lane.ev.sort((a, b) => a[0] - b[0] || ((a[1] & 0xf0) === 0x80 ? -1 : 1));
    const bytes = [];
    const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); bytes.push(...out); };
    const name = new TextEncoder().encode(lane.name);
    vlq(0); bytes.push(0xff, 0x03, name.length, ...name);
    if (first) {
      const tempo = Math.round(60000000 / song.bpm);
      vlq(0); bytes.push(0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
      vlq(0); bytes.push(0xff, 0x58, 0x04, 4, 2, 24, 8);
    }
    let last = 0;
    for (const [t, st, a, b] of ev) { vlq(t - last); last = t; bytes.push(st, a, b); }
    vlq(Math.max(0, end - last)); bytes.push(0xff, 0x2f, 0x00);
    return chunk(bytes);
  };
  const list = [lanes.drums, ...['bass', 'chord', 'lead'].filter((k) => lanes[k]).map((k) => lanes[k])];
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, list.length, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...head, ...list.flatMap((l, k) => trackBytes(l, k === 0))]);
}

// Hand a file to the person: the Android app saves it to Music or Download,
// a phone browser offers the share sheet, a computer downloads it.
export async function deliver(bytes, name, mime) {
  if (window.PopNative) {
    const id = window.PopNative.beginFile(name, mime);
    if (!id) throw new Error('Could not start the file');
    for (let o = 0; o < bytes.length; o += 0x30000) {
      let s = ''; const part = bytes.subarray(o, o + 0x30000);
      for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
      if (!window.PopNative.appendFile(id, btoa(s))) throw new Error('Could not write the file');
    }
    const res = JSON.parse(window.PopNative.finishFile(id));
    if (!res.ok) throw new Error(res.error || 'Could not save the file');
    return `Saved to ${res.where}`;
  }
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return 'Shared'; } catch (e) { if (e.name === 'AbortError') return ''; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'Downloaded';
}

// ---------- handing the beat to Boba Beats ----------
// A Boba Beats song: a "Pop Pads" sampler track holding the drums as they
// sound here (pitch, length, filter, crush and volume baked in), placed on
// Boba's bubbles in the same 4×4 layout, with the pattern (or chain) as its
// notes; plus Boba's usual bass, chords and melody tracks, empty.
const B_PPQ = 96, B_STEP = 24, B_BAR = 384, B_COLS = 5;
const bid = () => Math.random().toString(36).slice(2, 10);

// One drum as a one-shot for Boba's sampler, with its settings and the mix
// (filter, drive, crush and the reverb's tail) baked in. `tw`: the settings
// for this version of the drum (its own, or a step's).
async function padSample(song, i, tw, sr) {
  const { Graph, voiceFor } = await import('./engine.js');
  const { renderKit, renderTone, TONAL } = await import('./kits.js');
  const bufs = await renderKit(song.kit, sr);
  if (TONAL.includes(i)) await renderTone(song.kit, i, Math.round(tw.pitch || 0), sr);
  let buf; [buf, tw] = voiceFor(song.kit, bufs, i, tw, sr);
  const rate = Math.pow(2, tw.pitch / 12), verb = (song.fx.verb || 0) > 0.02 ? 1.1 : 0;
  const len = buf.duration / rate * Math.max(0.04, tw.len) + 0.03 + verb;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const g = await Graph.create(ctx);
  // the LFO moves over time, so it cannot live in a one-shot: it is left out
  g.setFx({ ...song.fx, lfo: 0 }, song.bpm, 0);
  g.play(i, buf, 0, { ...tw, lfo: 0, nudge: 0, rep: 1 });
  const out = await ctx.startRendering(), L = out.getChannelData(0), R = out.getChannelData(1);
  // mono for Boba's sampler, trimmed where the sound has died away
  const mono = new Float32Array(L.length);
  let end = 0;
  for (let k = 0; k < L.length; k++) { mono[k] = (L[k] + R[k]) / 2; if (Math.abs(mono[k]) > 0.0005) end = k; }
  const n = Math.min(mono.length, end + Math.round(sr * 0.02)), data = mono.slice(0, n);
  for (let k = Math.max(0, n - 200); k < n; k++) data[k] *= (n - k) / 200;
  return { name: KITS[song.kit].pads[i].name, sr, data };
}
// Boba levels its own samples to 90% of full scale and plays every sampler
// sound relative to that; Pop's drums come out of its mix much lower. So the
// whole kit is raised together until its loudest drum peaks at 90%, which
// keeps the balance between the drums exactly as it was in Pop Pads.
function packForBoba(drums) {
  let top = 0;
  for (const d of drums) for (const v of d.data) top = Math.max(top, Math.abs(v));
  const g = top > 0 ? 0.9 / top : 1;
  return drums.map((d) => {
    const pcm = new Int16Array(d.data.length);
    for (let k = 0; k < pcm.length; k++) pcm[k] = Math.max(-32768, Math.min(32767, Math.round(d.data[k] * g * 32767)));
    const bytes = new Uint8Array(pcm.buffer);
    let s = ''; for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return { name: d.name, root: 60, pitched: false, sr: d.sr, pcm: btoa(s) };
  });
}

// Boba's bubbles not used by the 4×4 layout: the right-hand column and the top row
const SPARE = [4, 9, 14, 19, 24, 20, 21, 22, 23];

export async function bobaSong(song) {
  const { padAt, tweakOf } = await import('./engine.js');
  const { TONAL } = await import('./kits.js');
  const chain = song.chain.length > 1 ? song.chain.slice() : [song.cur];
  // one Boba section (loop) per pattern, in the order they first appear; the
  // chain becomes Boba's song, so any length comes across
  const order = [...new Set(chain)];
  const used = [...Array(16).keys()].filter((i) => order.some((pi) => song.patterns[pi][i]));
  const drumsUsed = used.filter((i) => !TONAL.includes(i)), tonalUsed = used.filter((i) => TONAL.includes(i));
  const hits = (i) => { const out = []; for (const pi of order) for (let st = 0; st < STEPS; st++) if ((song.patterns[pi][i] >> st) & 1) out.push(padAt(song, pi, i, st)); return out; };
  // every version of each sound: its own settings, and each different set a step gives it
  const look = (tw) => JSON.stringify(['pitch', 'len', 'filt', 'vol', 'crush'].map((k) => +(tw[k] || 0).toFixed(3)));
  const versions = [];                // { i, tw, slot, lane }
  const slotOf = new Map();           // `${i}|${key}` -> Boba slot
  // the drums: Boba's bubbles in the same 4×4 layout, extra versions on the spare bubbles
  let spare = 0;
  for (const i of drumsUsed) {
    const own = tweakOf(song, i), slot = Math.floor(i / 4) * B_COLS + (i % 4);
    versions.push({ i, tw: own, slot, lane: 'drums' }); slotOf.set(`${i}|${look(own)}`, slot);
  }
  for (const pi of order) for (let st = 0; st < STEPS; st++) for (const i of drumsUsed) {
    if (!((song.patterns[pi][i] >> st) & 1)) continue;
    const tw = padAt(song, pi, i, st), key = look(tw);
    if (slotOf.has(`${i}|${key}`) || spare >= SPARE.length) continue;
    const slot = SPARE[spare++];
    versions.push({ i, tw, slot, lane: 'drums' }); slotOf.set(`${i}|${key}`, slot);
  }
  // the bass, chord and lead: each its own Boba track, one bubble per note it
  // plays, low to high from the bottom-left, so the tune reads up the grid
  for (const i of tonalUsed) {
    const seen = new Map();
    for (const tw of hits(i)) { const key = look(tw); if (!seen.has(key)) seen.set(key, tw); }
    [...seen.entries()].sort((x, y) => (x[1].pitch || 0) - (y[1].pitch || 0)).slice(0, 25)
      .forEach(([key, tw], k) => { versions.push({ i, tw, slot: k, lane: i }); slotOf.set(`${i}|${key}`, k); });
  }
  const samples = {}, kits = { drums: {} };
  const sounds = [];
  for (const v of versions) {
    const d = await padSample(song, v.i, v.tw, 44100);
    if (v.lane === 'drums' && v.slot !== Math.floor(v.i / 4) * B_COLS + (v.i % 4)) d.name += ' ✦';
    if (v.lane !== 'drums') { const p = Math.round(v.tw.pitch || 0); d.name += p ? ` ${p > 0 ? '+' : ''}${p}` : ''; }
    sounds.push(d);
  }
  // everything raised together, so drums, bass and chords keep their balance
  packForBoba(sounds).forEach((packed, k) => { const id = 's' + bid(); samples[id] = packed; (kits[versions[k].lane] = kits[versions[k].lane] || {})[versions[k].slot] = id; });
  const track = (role, name, inst, extra = {}) => ({ id: bid(), role, name, inst, vol: 0.8, pan: 0, oct: 0, rev: 0.1, dly: 0, chord: 'off', ...extra });
  const ROLE = { bass: 'bass', chord: 'pads', lead: 'melody' };
  const lanes = [];                   // [lane, track]
  if (drumsUsed.length || !tonalUsed.length) lanes.push(['drums', track('melody', 'Pop Pads', 'sampler', { vol: 0.9, rev: 0, smp: { mode: 'kit', key: null, kit: kits.drums } })]);
  for (const i of tonalUsed) { const pad = KITS[song.kit].pads[i]; lanes.push([i, track(ROLE[pad.tone], `Pop ${pad.name}`, 'sampler', { vol: 0.9, rev: 0, pan: 0, smp: { mode: 'kit', key: null, kit: kits[i] || {} } })]); }
  // Boba's own players, for whatever Pop Pads did not bring
  const brought = new Set(tonalUsed.map((i) => ROLE[KITS[song.kit].pads[i].tone]));
  const others = [track('bass', 'Bass', 'bassGuitar', { rev: 0 }), track('pads', 'Pads', 'epiano', { vol: 0.7, rev: 0.3, chord: 'triad', pan: -0.1 }), track('melody', 'Melody', 'piano', { vol: 0.75, rev: 0.25, dly: 0.15, pan: 0.1 })]
    .filter((t) => !brought.has(t.role));
  const tracks = [...lanes.map(([, t]) => t), ...others];
  const sections = order.map((pi) => {
    const ev = Object.fromEntries(tracks.map((t) => [t.id, []]));
    for (let st = 0; st < STEPS; st++) for (const i of used) {
      if (!((song.patterns[pi][i] >> st) & 1)) continue;
      const lane = TONAL.includes(i) ? i : 'drums', t = lanes.find(([l]) => l === lane)[1];
      const tw = padAt(song, pi, i, st), slot = slotOf.get(`${i}|${look(tw)}`) ?? (lane === 'drums' ? Math.floor(i / 4) * B_COLS + (i % 4) : 0);
      const k = Math.max(1, Math.min(4, Math.round(tw.rep || 1)));
      for (let j = 0; j < k; j++) {
        const at = Math.max(0, Math.min(B_BAR - 1, st * B_STEP + Math.round((tw.nudge || 0) * B_STEP + (j * B_STEP) / k)));
        ev[t.id].push({ t: at, d: Math.max(4, Math.round(B_STEP / k)), r: Math.floor(slot / B_COLS), c: slot % B_COLS, v: j ? 0.7 : 0.85 });
      }
    }
    for (const list of Object.values(ev)) list.sort((a, b) => a.t - b.t);
    return { bars: 1, ev, fx: [], mute: {} };
  });
  // the chain, as Boba's song: repeats of the same pattern in a row become one block
  const songBlocks = [];
  for (const pi of chain) {
    const sec = order.indexOf(pi), last = songBlocks[songBlocks.length - 1];
    if (last && last.sec === sec) last.rep++; else songBlocks.push({ sec, rep: 1, off: {}, fx: [] });
  }
  const now = Date.now();
  return {
    v: 1, id: bid(), name: `Pop Pads ${KITS[song.kit].name} beat`, created: now, modified: now,
    bpm: song.bpm, swing: Math.min(1, song.swing * 1.32), key: 0, scale: 'minor', quant: B_STEP, metro: true, master: 'sweet',
    tracks, sections, cur: 0, song: chain.length > 1 ? songBlocks : [], latch: {}, space: { rev: 'hall', dly: 'ping' },
    samples,
  };
}

// The website: Pop Pads and Boba Beats share this site's storage, so the song
// waits in IndexedDB and Boba picks it up when it opens with ?from=pop.
export function handOff(file) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bubble-handoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('songs');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('songs', 'readwrite');
      tx.objectStore('songs').put({ file, at: Date.now() }, 'pop');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
