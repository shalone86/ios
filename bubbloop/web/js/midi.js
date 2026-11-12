// Web MIDI input and output for desktop browsers.
// Input lets MIDI keyboards and drum pads play and record Bubbloop's grid.
// Output sends live taps and sequenced loops out to external synths or a DAW.

import { ROWS, COLS, cellNotes, midiName } from './theory.js';
import { DRUM_PADS, padFor } from './drums.js';
import { instrumentById } from './instruments.js';

export function centsToBend14(cents) {
  const v = Math.max(0, Math.min(16383, Math.round(8192 + (cents / 200) * 8192)));
  return [v & 127, (v >> 7) & 127];
}

export function bend14ToCents(val) {
  return ((val - 8192) / 8192) * 200;
}

export function channelForTrack(project, track) {
  if (!track) return 0;
  if (track.role === 'drums') return 9;
  let ch = 0;
  for (const t of project.tracks) {
    if (t.role === 'drums') continue;
    if (t.id === track.id) return ch % 16;
    ch++;
    if (ch === 9) ch++;
  }
  return 0;
}

export function notesForCell(project, track, row, col, chord = 'off', acc = 0) {
  if (track.role === 'drums') return [padFor(track, row, col).pad.gm];
  if (track.inst === 'sampler' && track.smp && track.smp.mode === 'kit') return [36 + row * COLS + col];
  return cellNotes(project, track, row, col, chord, acc).filter((n) => n >= 0 && n <= 127);
}

// Map an incoming MIDI note 0..127 onto a bubble { r, c, acc } on `track`.
export function mapInputNote(project, track, midiNote, opts = {}) {
  const inputMode = opts.inputMode || 'chromatic';
  const drumMode = opts.drumMode || 'gm';

  if (track.role === 'drums') {
    let idx = -1;
    if (!track.group && drumMode === 'gm') {
      idx = DRUM_PADS.slice(0, ROWS * COLS).findIndex((p) => p.gm === midiNote);
    }
    if (idx < 0) idx = ((midiNote - 36) % (ROWS * COLS) + (ROWS * COLS)) % (ROWS * COLS);
    return { r: Math.floor(idx / COLS), c: idx % COLS, acc: 0 };
  }

  if (track.inst === 'sampler' && track.smp && track.smp.mode === 'kit') {
    const idx = ((midiNote - 36) % (ROWS * COLS) + (ROWS * COLS)) % (ROWS * COLS);
    return { r: Math.floor(idx / COLS), c: idx % COLS, acc: 0 };
  }

  const lo = cellNotes(project, track, 0, 0, 'off', 0)[0];
  const hi = cellNotes(project, track, ROWS - 1, COLS - 1, 'off', 0)[0];
  let m = midiNote;
  while (m < lo - 1) m += 12;
  while (m > hi + 1) m -= 12;

  let bestR = 0, bestC = 0, bestBase = lo, bestDist = Infinity;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const base = cellNotes(project, track, r, c, 'off', 0)[0];
      const dist = Math.abs(m - base);
      if (dist < bestDist) {
        bestDist = dist;
        bestR = r;
        bestC = c;
        bestBase = base;
      }
    }
  }
  return { r: bestR, c: bestC, acc: inputMode === 'scale' ? 0 : m - bestBase };
}

export class MidiController {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.access = null;
    this.error = null;
    this.connecting = false;
    this.heldIn = new Map();       // `${portId}:${ch}:${note}` -> { id, trackId, r, c, ch, portId, sustained }
    this.sustainDown = new Set();  // `${portId}:${ch}`
    this.activeOut = new Map();    // noteId -> { out, ch, notes }
    this.lastActivity = null;      // { dir: 'in'|'out', text, at }
    this._onPortMsg = new Map();
  }

  get supported() {
    try {
      return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
    } catch (e) {
      return false;
    }
  }

  get connected() {
    return !!this.access;
  }

  settings() {
    return (this.hooks.getSettings && this.hooks.getSettings()) || {
      inId: 'all', outId: '', inputMode: 'chromatic', drumMode: 'gm', routing: 'omni', localSound: true, clockOut: false,
    };
  }

  async connect(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav || typeof nav.requestMIDIAccess !== 'function') {
      this.error = 'Web MIDI is not available in this browser';
      this.notify();
      return false;
    }
    if (this.access) return true;
    if (this.connecting) return false;
    this.connecting = true;
    this.error = null;
    try {
      this.access = await nav.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this.bindInputs();
        this.sendProgramChanges();
        this.notify();
      };
      this.bindInputs();
      this.sendProgramChanges();
      this.notify();
      return true;
    } catch (e) {
      this.error = (e && e.message) || 'MIDI permission was denied';
      this.notify();
      return false;
    } finally {
      this.connecting = false;
    }
  }

  bindInputs() {
    if (!this.access) return;
    const seen = new Set();
    for (const input of this.access.inputs.values()) {
      seen.add(input.id);
      if (!this._onPortMsg.has(input.id)) {
        const fn = (ev) => this.handleMessage(input, ev.data);
        this._onPortMsg.set(input.id, fn);
        input.onmidimessage = fn;
      } else if (input.onmidimessage !== this._onPortMsg.get(input.id)) {
        input.onmidimessage = this._onPortMsg.get(input.id);
      }
    }
    for (const id of [...this._onPortMsg.keys()]) {
      if (!seen.has(id)) this._onPortMsg.delete(id);
    }
  }

  inputs() {
    if (!this.access) return [];
    return [...this.access.inputs.values()]
      .filter((p) => p.state === 'connected')
      .map((p) => ({ id: p.id, name: p.name || 'MIDI Input', manufacturer: p.manufacturer || '' }));
  }

  outputs() {
    if (!this.access) return [];
    return [...this.access.outputs.values()]
      .filter((p) => p.state === 'connected')
      .map((p) => ({ id: p.id, name: p.name || 'MIDI Output', manufacturer: p.manufacturer || '' }));
  }

  activeOutput() {
    if (!this.access) return null;
    const id = this.settings().outId;
    if (!id) return null;
    const port = this.access.outputs.get(id);
    return port && port.state === 'connected' ? port : null;
  }

  notify() {
    if (this.hooks.onChange) this.hooks.onChange();
  }

  markActivity(dir, text) {
    this.lastActivity = { dir, text, at: Date.now() };
    this.notify();
  }

  targetTrack(project, ch) {
    const st = this.settings();
    if (st.routing === 'channel' && project && project.tracks.length) {
      if (ch === 9) {
        const drums = project.tracks.find((t) => t.role === 'drums');
        if (drums) return drums;
      }
      return project.tracks[ch % project.tracks.length];
    }
    return this.hooks.getCurTrack ? this.hooks.getCurTrack() : project?.tracks[0];
  }

  handleMessage(port, data) {
    if (!data || data.length < 1) return;
    const status = data[0];
    if (status >= 0xf0) return;          // ignore clock/sysex on input

    const st = this.settings();
    if (st.inId === '') return;
    if (st.inId && st.inId !== 'all' && st.inId !== port.id) return;

    const project = this.hooks.getProject && this.hooks.getProject();
    if (!project) return;

    const cmd = status & 0xf0;
    const ch = status & 0x0f;
    const d1 = data[1] || 0;
    const d2 = data[2] || 0;
    const portKey = `${port.id}:${ch}`;

    if (cmd === 0x90 && d2 > 0) {
      const key = `${portKey}:${d1}`;
      if (this.heldIn.has(key)) this.releaseInKey(key);
      const track = this.targetTrack(project, ch);
      if (!track) return;
      const mapped = mapInputNote(project, track, d1, { inputMode: st.inputMode, drumMode: st.drumMode });
      const vel = Math.max(0.08, Math.min(1, d2 / 127));
      this.markActivity('in', `${midiName(d1)} · vel ${d2}`);
      const id = this.hooks.onNoteOn ? this.hooks.onNoteOn({ track, r: mapped.r, c: mapped.c, acc: mapped.acc, vel, note: d1 }) : 0;
      if (id) this.heldIn.set(key, { id, trackId: track.id, r: mapped.r, c: mapped.c, portKey, sustained: false });
      return;
    }

    if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      const key = `${portKey}:${d1}`;
      const entry = this.heldIn.get(key);
      if (!entry) return;
      if (this.sustainDown.has(portKey)) entry.sustained = true;
      else this.releaseInKey(key);
      return;
    }

    if (cmd === 0xe0) {
      const cents = bend14ToCents((d2 << 7) | d1);
      for (const entry of this.heldIn.values()) {
        if (entry.portKey === portKey && this.hooks.onBend) this.hooks.onBend(entry.id, cents);
      }
      return;
    }

    if (cmd === 0xb0) {
      if (d1 === 64) {
        if (d2 >= 64) this.sustainDown.add(portKey);
        else {
          this.sustainDown.delete(portKey);
          for (const [k, entry] of [...this.heldIn.entries()]) {
            if (entry.portKey === portKey && entry.sustained) this.releaseInKey(k);
          }
        }
      } else if (d1 === 120 || d1 === 123) {
        this.sustainDown.delete(portKey);
        for (const [k, entry] of [...this.heldIn.entries()]) {
          if (entry.portKey === portKey) this.releaseInKey(k);
        }
      }
    }
  }

  releaseInKey(key) {
    const entry = this.heldIn.get(key);
    if (!entry) return;
    this.heldIn.delete(key);
    if (this.hooks.onNoteOff) this.hooks.onNoteOff(entry.id, entry);
  }

  // ---------- MIDI Output ----------

  send(out, bytes, timestamp) {
    if (!out) return;
    try {
      if (timestamp != null) out.send(bytes, timestamp);
      else out.send(bytes);
    } catch (e) { /* port may have disconnected */ }
  }

  sendProgramChanges() {
    const out = this.activeOutput();
    const project = this.hooks.getProject && this.hooks.getProject();
    if (!out || !project) return;
    for (const track of project.tracks) this.syncTrack(track);
  }

  syncAll() {
    this.sendProgramChanges();
  }

  syncTrack(track) {
    const out = this.activeOutput();
    const project = this.hooks.getProject && this.hooks.getProject();
    if (!out || !project || !track || track.role === 'drums') return;
    const ch = channelForTrack(project, track);
    const inst = instrumentById(track.inst);
    this.send(out, [0xc0 | ch, inst.gm]);
    for (const [cc, v] of [[101, 0], [100, 0], [6, 2], [38, 0]]) {
      this.send(out, [0xb0 | ch, cc, v]);
    }
  }

  noteOn(id, track, row, col, chord = 'off', vel = 0.85, acc = 0) {
    const out = this.activeOutput();
    const project = this.hooks.getProject && this.hooks.getProject();
    if (!out || !project || !track) return;
    const ch = channelForTrack(project, track);
    const notes = notesForCell(project, track, row, col, chord, acc);
    const v = Math.max(1, Math.min(127, Math.round(vel * 127)));
    for (const n of notes) this.send(out, [0x90 | ch, n, v]);
    if (id && notes.length) this.activeOut.set(id, { out, ch, notes });
    if (notes.length) this.markActivity('out', `${midiName(notes[0])} → ch ${ch + 1}`);
  }

  bend(id, cents) {
    const act = this.activeOut.get(id);
    if (!act) return;
    const [lsb, msb] = centsToBend14(cents);
    this.send(act.out, [0xe0 | act.ch, lsb, msb]);
  }

  noteOff(id) {
    const act = this.activeOut.get(id);
    if (!act) return;
    this.activeOut.delete(id);
    for (const n of act.notes) this.send(act.out, [0x80 | act.ch, n, 0]);
    this.send(act.out, [0xe0 | act.ch, 0, 64]);
  }

  scheduleNote(track, ev, time, engineNow, durSec, gain = 1) {
    const out = this.activeOutput();
    const project = this.hooks.getProject && this.hooks.getProject();
    if (!out || !project || !track) return;
    const ch = channelForTrack(project, track);
    const notes = notesForCell(project, track, ev.r, ev.c, ev.ch, ev.a);
    if (!notes.length) return;
    const baseNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const onTs = baseNow + Math.max(0, (time - engineNow) * 1000);
    const offTs = onTs + Math.max(15, durSec * 1000 - 4);
    const vel = Math.max(1, Math.min(127, Math.round(Math.min(1, ev.v * gain) * 127)));
    if (track.role !== 'drums' && ev.b && ev.b.length) {
      const spt = 60 / (project.bpm * 96);
      for (const [dt, cents] of ev.b) {
        const bt = onTs + dt * spt * 1000;
        if (bt < offTs) {
          const [lsb, msb] = centsToBend14(cents);
          this.send(out, [0xe0 | ch, lsb, msb], bt);
        }
      }
      this.send(out, [0xe0 | ch, 0, 64], offTs);
    }
    for (const n of notes) {
      this.send(out, [0x90 | ch, n, vel], onTs);
      this.send(out, [0x80 | ch, n, 0], offTs);
    }
  }

  clockStep(stepTime, engineNow, spt) {
    const out = this.activeOutput();
    if (!out || !this.settings().clockOut) return;
    const baseNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const startTs = baseNow + Math.max(0, (stepTime - engineNow) * 1000);
    const pulseMs = 4 * spt * 1000;   // 96 PPQ / 24 MIDI clocks per beat = 4 ticks
    for (let k = 0; k < 6; k++) this.send(out, [0xf8], startTs + k * pulseMs);
  }

  start() {
    const out = this.activeOutput();
    if (out && this.settings().clockOut) this.send(out, [0xfa]);
  }

  stop() {
    for (const id of [...this.activeOut.keys()]) this.noteOff(id);
    const out = this.activeOutput();
    if (!out) return;
    for (let ch = 0; ch < 16; ch++) {
      this.send(out, [0xb0 | ch, 123, 0]);
      this.send(out, [0xe0 | ch, 0, 64]);
    }
    if (this.settings().clockOut) this.send(out, [0xfc]);
  }

  panic() {
    for (const key of [...this.heldIn.keys()]) this.releaseInKey(key);
    this.sustainDown.clear();
    for (const id of [...this.activeOut.keys()]) this.noteOff(id);
    const out = this.activeOutput();
    if (!out) return;
    for (let ch = 0; ch < 16; ch++) {
      this.send(out, [0xb0 | ch, 64, 0]);
      this.send(out, [0xb0 | ch, 120, 0]);
      this.send(out, [0xb0 | ch, 123, 0]);
      this.send(out, [0xe0 | ch, 0, 64]);
    }
  }
}
