// The project model: plain JSON, saved to localStorage. Nothing is ever
// committed to audio; a song is note data until the moment it is exported.

import { BAR, STEP } from './theory.js';
import { DRUM_PADS, PAD_INDEX, DRUM_GROUPS } from './drums.js';
import { PATTERNS } from './patterns.js';

const INDEX_KEY = 'bubbloop.index';
const LAST_KEY = 'bubbloop.last';
const SETTINGS_KEY = 'bubbloop.settings';
const P = (id) => 'bubbloop.p.' + id;

export const MAX_TRACKS = 12;
export const MAX_SECTIONS = 8;
export const SECTION_NAMES = 'ABCDEFGH';

const ADJ = ['Sleepy', 'Fizzy', 'Moonlit', 'Peachy', 'Wobbly', 'Cosmic', 'Cozy', 'Sparkly', 'Dreamy', 'Mellow', 'Bouncy', 'Starry', 'Minty', 'Fluffy', 'Sunny'];
const NOUN = ['Comet', 'Parade', 'Nebula', 'Boba', 'Lagoon', 'Picnic', 'Pillow', 'Jellyfish', 'Carousel', 'Raindrop', 'Lantern', 'Meadow', 'Mochi', 'Balloon', 'Tadpole'];

const uid = () => Math.random().toString(36).slice(2, 10);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const ROLE_DEFAULTS = {
  drums:  { name: 'Drums',  inst: 'drums',      vol: 0.8,  rev: 0.06, dly: 0,    chord: 'off',   pan: 0 },
  bass:   { name: 'Bass',   inst: 'bassGuitar', vol: 0.8,  rev: 0,    dly: 0,    chord: 'off',   pan: 0 },
  pads:   { name: 'Pads',   inst: 'epiano',     vol: 0.7,  rev: 0.3,  dly: 0,    chord: 'triad', pan: -0.1 },
  melody: { name: 'Melody', inst: 'piano',      vol: 0.75, rev: 0.25, dly: 0.15, chord: 'off',   pan: 0.1 },
};

export function makeTrack(role, inst) {
  const d = ROLE_DEFAULTS[role];
  return { id: uid(), role, name: d.name, inst: inst || d.inst, vol: d.vol, pan: d.pan, oct: 0, rev: d.rev, dly: d.dly, chord: d.chord };
}

export function makeSection(tracks) {
  return { bars: 2, ev: Object.fromEntries(tracks.map((t) => [t.id, []])), fx: [], mute: {} };
}

export function newProject(name) {
  const tracks = ['drums', 'bass', 'pads', 'melody'].map((r) => makeTrack(r));
  return {
    v: 1, id: uid(), name: name || `${pick(ADJ)} ${pick(NOUN)}`, created: Date.now(), modified: Date.now(),
    bpm: 92, swing: 0, key: 0, scale: 'major', quant: STEP, metro: true, master: 'sweet',
    tracks, sections: [makeSection(tracks)], cur: 0, song: [], latch: {}, space: { rev: 'hall', dly: 'ping' },
  };
}

// A short ready-made song that shows what the pieces do: two sections,
// four tracks, and an arrangement that brings them in one by one.
export function demoProject() {
  const p = newProject('Demo: Sleepy Boba');
  const [drums, bass, pads, melody] = p.tracks;
  p.bpm = 88; p.key = 0; p.scale = 'major';
  melody.inst = 'kalimba'; melody.dly = 0.25;
  const A = p.sections[0];
  A.bars = 4;
  applyPattern(p, 0, drums.id, 'lofi');
  // C, Am, Em, G: one chord a bar
  A.ev[pads.id] = [[0, 1, 0], [1, 0, 4], [2, 1, 2], [3, 1, 3]]
    .map(([bar, r, c]) => ({ t: bar * BAR, d: BAR - 24, r, c, v: 0.7, ch: 'triad' }));
  A.ev[bass.id] = [[0, 0, 3], [1, 4, 2], [2, 2, 3], [3, 3, 1]].flatMap(([bar, root, other]) => [
    { t: bar * BAR, d: 130, r: 0, c: root, v: 0.85 },
    { t: bar * BAR + 144, d: 40, r: 0, c: root, v: 0.7 },
    { t: bar * BAR + 288, d: 80, r: 0, c: other, v: 0.8 },
  ]);
  const tune = [
    [0, 0, 2, 2, 40], [0, 96, 2, 3, 40], [0, 144, 2, 4, 80], [0, 240, 2, 3, 90],
    [1, 48, 2, 2, 80], [1, 144, 2, 1, 40], [1, 192, 2, 0, 150],
    [2, 0, 2, 3, 40], [2, 96, 2, 4, 40], [2, 144, 3, 0, 80], [2, 240, 2, 4, 90],
    [3, 48, 2, 3, 80], [3, 144, 2, 2, 40], [3, 192, 2, 1, 170],
  ];
  A.ev[melody.id] = tune.map(([bar, t, r, c, d]) => ({ t: bar * BAR + t, d, r, c, v: 0.8 }));

  // B: the same chords with a busier beat and the tune an octave up
  p.sections.push(JSON.parse(JSON.stringify(A)));
  applyPattern(p, 1, drums.id, 'boombap');
  const B = p.sections[1];
  B.ev[melody.id] = tune.map(([bar, t, r, c, d]) => ({ t: bar * BAR + t, d, r: r + 1, c, v: 0.75 }));
  B.ev[drums.id].push({ t: 3 * BAR + 336, d: STEP, r: 4, c: 4, v: 0.8 });   // a sparkle into the turnaround
  B.ev[drums.id].sort((a, b) => a.t - b.t);
  B.fx = [{ t: 3 * BAR + 288, d: 96, k: 'stutter', p: 1 }];

  p.swing = 0.35;
  const off = (...tracks) => Object.fromEntries(tracks.map((t) => [t.id, true]));
  p.song = [
    { sec: 0, rep: 1, off: off(drums, bass, melody), fx: [] },
    { sec: 0, rep: 1, off: off(melody), fx: [] },
    { sec: 0, rep: 2, off: {}, fx: [] },
    { sec: 1, rep: 2, off: {}, fx: [] },
    { sec: 0, rep: 1, off: off(drums), fx: [] },
  ];
  p.cur = 0;
  clearUndo();
  return p;
}

// ---------- persistence ----------

const strip = (k, v) => (k[0] === '_' ? undefined : v);

function readJSON(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch (e) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value, strip)); return true; } catch (e) { return false; }
}

export function listProjects() {
  return readJSON(INDEX_KEY, []).sort((a, b) => b.modified - a.modified);
}

export function saveProject(p) {
  p.modified = Date.now();
  if (!writeJSON(P(p.id), p)) return false;
  const index = readJSON(INDEX_KEY, []).filter((e) => e.id !== p.id);
  index.push({ id: p.id, name: p.name, modified: p.modified, bpm: p.bpm });
  writeJSON(INDEX_KEY, index);
  try { localStorage.setItem(LAST_KEY, p.id); } catch (e) { /* private mode */ }
  return true;
}

export function loadProject(id) {
  const p = readJSON(P(id), null);
  return p ? repair(p) : null;
}

export function loadLast() {
  let id = null;
  try { id = localStorage.getItem(LAST_KEY); } catch (e) { /* private mode */ }
  return (id && loadProject(id)) || null;
}

export function deleteProject(id) {
  try { localStorage.removeItem(P(id)); } catch (e) { /* ignore */ }
  writeJSON(INDEX_KEY, readJSON(INDEX_KEY, []).filter((e) => e.id !== id));
}

export function duplicateProject(p) {
  const copy = JSON.parse(JSON.stringify(p, strip));
  copy.id = uid();
  copy.name = p.name + ' 2';
  copy.created = Date.now();
  return copy;
}

export function serialize(p) {
  return JSON.stringify(p, strip);
}

// Accept a project from disk or an import and make sure nothing is missing.
export function repair(p) {
  if (!p || !Array.isArray(p.tracks) || !Array.isArray(p.sections)) return null;
  const base = newProject(p.name);
  if (!p.space) p.space = { rev: 'hall', dly: 'ping' };
  for (const k of ['bpm', 'swing', 'key', 'scale', 'quant', 'metro', 'master', 'latch', 'cur', 'song']) {
    if (p[k] === undefined) p[k] = base[k];
  }
  p.id = p.id || uid();
  p.bpm = Math.min(200, Math.max(50, +p.bpm || 92));
  p.tracks = p.tracks.slice(0, MAX_TRACKS);
  for (const t of p.tracks) {
    const d = ROLE_DEFAULTS[t.role] || ROLE_DEFAULTS.melody;
    for (const k of Object.keys(d)) if (t[k] === undefined) t[k] = d[k];
    if (t.oct === undefined) t.oct = 0;
  }
  for (const s of p.sections) {
    s.bars = [1, 2, 4, 8].includes(s.bars) ? s.bars : 2;
    s.ev = s.ev || {};
    s.fx = s.fx || [];
    s.mute = s.mute || {};
    for (const t of p.tracks) if (t.mute) s.mute[t.id] = true;      // older saves muted a track everywhere
    for (const t of p.tracks) {
      s.ev[t.id] = (s.ev[t.id] || []).filter((e) => e && e.t >= 0 && e.t < s.bars * BAR).sort((a, b) => a.t - b.t);
    }
  }
  for (const t of p.tracks) delete t.mute;
  p.cur = Math.min(p.cur || 0, p.sections.length - 1);
  p.song = (p.song || []).filter((b) => b.sec < p.sections.length);
  for (const b of p.song) { b.off = b.off || {}; b.fx = b.fx || []; b.rep = b.rep || 1; }
  return p;
}

export function loadSettings() {
  const st = Object.assign({ haptics: true, names: false, tapOffset: 0, metroPlay: false, smooth: 'off', advanced: false, versions: false, builtin: true }, readJSON(SETTINGS_KEY, {}));
  if (st.smooth !== 'on') st.smooth = 'off';      // the big buffer slows taps: only when asked for
  return st;
}
export function saveSettings(s) {
  writeJSON(SETTINGS_KEY, s);
}

// ---------- undo ----------

const undoStack = [];
const redoStack = [];
const snap = (p) => JSON.stringify({ sections: p.sections, song: p.song, tracks: p.tracks, cur: p.cur }, strip);

export function pushUndo(p) {
  undoStack.push(snap(p));
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
}
function restore(p, s) {
  const o = JSON.parse(s);
  p.sections = o.sections; p.song = o.song; p.tracks = o.tracks;
  p.cur = Math.min(o.cur, p.sections.length - 1);
}
export function undo(p) {
  if (!undoStack.length) return false;
  redoStack.push(snap(p));
  restore(p, undoStack.pop());
  return true;
}
export function redo(p) {
  if (!redoStack.length) return false;
  undoStack.push(snap(p));
  restore(p, redoStack.pop());
  return true;
}
export function clearUndo() {
  undoStack.length = 0;
  redoStack.length = 0;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

// ---------- editing ----------

// Mutes belong to a section, so A can have the drums resting while B has them playing.
export function isMuted(p, track, secIdx = p.cur) {
  const m = p.sections[secIdx] && p.sections[secIdx].mute;
  return !!(m && m[track.id]);
}
export function setMuted(p, track, on, secIdx = p.cur) {
  const s = p.sections[secIdx];
  s.mute = s.mute || {};
  if (on) s.mute[track.id] = true; else delete s.mute[track.id];
}

// The chord a bubble plays: its own if one was set (advanced mode), else the track's.
export function chordOf(track, col) {
  return (track.chords && track.chords[col]) || track.chord || 'off';
}

export function moveTrack(p, id, dir) {
  const i = p.tracks.findIndex((t) => t.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.tracks.length) return false;
  pushUndo(p);
  [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
  return true;
}

export function insertSorted(list, ev) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= ev.t) lo = mid + 1; else hi = mid;
  }
  list.splice(lo, 0, ev);
}

export function sectionLen(sec) {
  return sec.bars * BAR;
}

export function trackEvents(p, secIdx, trackId) {
  const sec = p.sections[secIdx];
  if (!sec.ev[trackId]) sec.ev[trackId] = [];
  return sec.ev[trackId];
}

export function sectionIsEmpty(sec) {
  return !Object.values(sec.ev).some((l) => l.length) && !sec.fx.length;
}

export function clearTrack(p, secIdx, trackId) {
  pushUndo(p);
  p.sections[secIdx].ev[trackId] = [];
}

export function clearCell(p, secIdx, trackId, row, col) {
  const list = trackEvents(p, secIdx, trackId);
  if (!list.some((e) => e.r === row && e.c === col)) return false;
  pushUndo(p);
  p.sections[secIdx].ev[trackId] = list.filter((e) => !(e.r === row && e.c === col));
  return true;
}

export function clearSection(p, secIdx) {
  pushUndo(p);
  const s = p.sections[secIdx];
  for (const k of Object.keys(s.ev)) s.ev[k] = [];
  s.fx = [];
}

export function clearFx(p, secIdx) {
  pushUndo(p);
  p.sections[secIdx].fx = [];
  for (const b of p.song) b.fx = [];
}

// Change loop length. Growing repeats what is there; shrinking keeps the start.
export function setBars(p, secIdx, bars) {
  const s = p.sections[secIdx];
  if (s.bars === bars) return;
  pushUndo(p);
  const oldLen = s.bars * BAR, newLen = bars * BAR;
  const fit = (list) => {
    const out = [];
    if (newLen > oldLen) {
      for (let off = 0; off < newLen; off += oldLen) for (const e of list) out.push({ ...e, t: e.t + off });
    } else {
      for (const e of list) if (e.t < newLen) out.push({ ...e, d: Math.min(e.d, newLen) });
    }
    return out;
  };
  for (const k of Object.keys(s.ev)) s.ev[k] = fit(s.ev[k]);
  s.fx = fit(s.fx);
  s.bars = bars;
}

export function addSection(p, copyFrom = null) {
  if (p.sections.length >= MAX_SECTIONS) return -1;
  pushUndo(p);
  const s = copyFrom == null ? makeSection(p.tracks) : JSON.parse(JSON.stringify(p.sections[copyFrom], strip));
  if (copyFrom == null) s.bars = p.sections[p.cur].bars;
  p.sections.push(s);
  return p.sections.length - 1;
}

export function removeSection(p, idx) {
  if (p.sections.length <= 1) return false;
  pushUndo(p);
  p.sections.splice(idx, 1);
  p.song = p.song.filter((b) => b.sec !== idx);
  for (const b of p.song) if (b.sec > idx) b.sec--;
  p.cur = Math.min(p.cur, p.sections.length - 1);
  return true;
}

export function addTrack(p, role, inst) {
  if (p.tracks.length >= MAX_TRACKS) return null;
  pushUndo(p);
  const t = makeTrack(role, inst);
  const same = p.tracks.filter((x) => x.role === role).length;
  if (same) t.name = `${t.name} ${same + 1}`;
  p.tracks.push(t);
  for (const s of p.sections) s.ev[t.id] = [];
  return t;
}

// Four drum tracks, one per family of sounds, each with its own fader and FX.
export function addDrumSplit(p) {
  const keys = Object.keys(DRUM_GROUPS);
  if (p.tracks.length + keys.length > MAX_TRACKS) return null;
  pushUndo(p);
  return keys.map((k) => {
    const t = makeTrack('drums');
    t.group = k;
    t.name = DRUM_GROUPS[k].name;
    p.tracks.push(t);
    for (const s of p.sections) s.ev[t.id] = [];
    return t;
  });
}

export function clearFxIn(p, lane) {
  pushUndo(p);
  lane.length = 0;
}

export function removeTrack(p, id) {
  if (p.tracks.length <= 1) return false;
  pushUndo(p);
  p.tracks = p.tracks.filter((t) => t.id !== id);
  for (const s of p.sections) { delete s.ev[id]; if (s.mute) delete s.mute[id]; s.fx = s.fx.filter((f) => f.tr !== id); }
  for (const b of p.song) { delete b.off[id]; if (b.sp) delete b.sp[id]; b.fx = b.fx.filter((f) => f.tr !== id); }
  return true;
}

// Snap what is already recorded onto the grid.
export function quantizeTrack(p, secIdx, trackId, grid) {
  if (!grid) return;
  pushUndo(p);
  const len = sectionLen(p.sections[secIdx]);
  const list = trackEvents(p, secIdx, trackId);
  for (const e of list) e.t = (Math.round(e.t / grid) * grid) % len;
  list.sort((a, b) => a.t - b.t);
}

// Step editing: flip one 16th for one bubble.
export function toggleStep(p, secIdx, track, row, col, step, grid = STEP, len = grid) {
  const list = trackEvents(p, secIdx, track.id);
  const t0 = step * grid;
  const hit = list.findIndex((e) => e.r === row && e.c === col && e.t >= t0 && e.t < t0 + grid);
  pushUndo(p);
  if (hit >= 0) { list.splice(hit, 1); return false; }
  const ev = { t: t0, d: track.role === 'drums' ? STEP : len, r: row, c: col, v: 0.85 };
  if (track.role !== 'drums' && chordOf(track, col) !== 'off') ev.ch = chordOf(track, col);
  insertSorted(list, ev);
  return true;
}

// ---------- your own grooves ----------
// A loop you made can be kept as a groove and dropped into any song. Grooves
// live on the device, not in a song.
const GROOVES_KEY = 'bubbloop.grooves';
export function listGrooves() {
  return readJSON(GROOVES_KEY, []);
}
export function saveGroove(p, secIdx, track, name) {
  const sec = p.sections[secIdx];
  const ev = (sec.ev[track.id] || []).map((e) => ({ t: e.t, r: e.r, c: e.c, v: e.v }));
  if (!ev.length) return null;
  const g = { id: uid(), name: name || 'My groove', len: sectionLen(sec), kind: track.group || 'kit', swing: p.swing, ev };
  const all = listGrooves();
  all.unshift(g);
  writeJSON(GROOVES_KEY, all);
  return g;
}
export function deleteGroove(id) {
  writeJSON(GROOVES_KEY, listGrooves().filter((g) => g.id !== id));
}
export function applyGroove(p, secIdx, trackId, g) {
  pushUndo(p);
  const sec = p.sections[secIdx], len = sectionLen(sec), out = [];
  for (let off = 0; off < len; off += g.len) {
    for (const e of g.ev) if (e.t + off < len) out.push({ t: e.t + off, d: STEP, r: e.r, c: e.c, v: e.v });
  }
  sec.ev[trackId] = out.sort((a, b) => a.t - b.t);
  if (g.swing != null) p.swing = g.swing;
}

// Lay a preset drum groove across the whole section.
export function applyPattern(p, secIdx, trackId, patternId) {
  const pat = PATTERNS.find((x) => x.id === patternId);
  if (!pat) return;
  pushUndo(p);
  const sec = p.sections[secIdx];
  const len = sectionLen(sec);
  const out = [];
  const patLen = pat.steps * STEP;
  // on a split track only that family's sounds are laid down
  const track = p.tracks.find((t) => t.id === trackId);
  const grp = track && DRUM_GROUPS[track.group];
  for (let off = 0; off < len; off += patLen) {
    for (const [padId, line] of Object.entries(pat.rows)) {
      const idx = PAD_INDEX[padId];
      const cells = line.replace(/\s/g, '');
      for (let s = 0; s < cells.length; s++) {
        const ch = cells[s];
        if (ch === '.' || ch === '-') continue;
        const t = off + s * STEP;
        if (t >= len) continue;
        const v = ch === 'X' ? 1 : ch === 'x' ? 0.78 : 0.45;
        if (grp) {
          const c = grp.pads.indexOf(padId === 'hat3' ? 'hat1' : padId === 'kick1' || padId === 'kick2' ? padId : padId);
          if (c >= 0) out.push({ t, d: STEP, r: 2, c, v });
        } else out.push({ t, d: STEP, r: Math.floor(idx / 5), c: idx % 5, v });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  sec.ev[trackId] = out;
  if (pat.swing != null) p.swing = pat.swing;
}

// ---------- song arrangement ----------

export function addBlock(p, at = p.song.length, from = null) {
  pushUndo(p);
  // A copy takes everything, spice and recorded FX included. A plain "+"
  // starts clean: the last block's section and repeats, that section's mutes.
  let b;
  if (from != null) b = JSON.parse(JSON.stringify(p.song[from], strip));
  else {
    const last = p.song[p.song.length - 1];
    const sec = last ? last.sec : p.cur;
    b = { sec, rep: last ? last.rep : 1, off: { ...(p.sections[sec].mute || {}) }, fx: [] };
  }
  p.song.splice(at, 0, b);
  return b;
}

export function removeBlock(p, idx) {
  pushUndo(p);
  p.song.splice(idx, 1);
}

export function moveBlock(p, idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= p.song.length) return idx;
  pushUndo(p);
  [p.song[idx], p.song[j]] = [p.song[j], p.song[idx]];
  return j;
}

export function songBars(p) {
  return p.song.reduce((n, b) => n + p.sections[b.sec].bars * b.rep, 0);
}

export function songSeconds(p) {
  return (songBars(p) * 4 * 60) / p.bpm;
}

export { DRUM_PADS };
