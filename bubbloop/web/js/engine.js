// Live engine: owns the AudioContext, runs the look-ahead scheduler,
// records what you play into the current loop, and plays songs.

import { PPQ, STEP, BAR, quantizeTick } from './theory.js';
import { getKit } from './drums.js';
import { ensureSamples, sampleIds } from './samples.js';
import { buildGraph } from './graph.js';
import { songSegments, scheduleRange, swingUnwarp } from './seq.js';
import { insertSorted, pushUndo, chordOf } from './state.js';

const LOOKAHEAD = 0.12;   // seconds scheduled ahead of the clock
const INTERVAL = 25;      // ms between scheduler runs

export class Engine {
  constructor() {
    this.ctx = null;
    this.g = null;
    this.project = null;
    this.playing = false;
    this.recording = false;
    this.mode = 'loop';        // 'loop' | 'song'
    this.queued = null;        // section waiting for the next loop boundary
    this.songFrom = 0;
    this.loopSong = false;
    this.tapOffset = 0;
    this.acc = 0;              // accidental applied to hand-played notes: -1, 0, +1
    this.smooth = 'off';       // 'on': bigger audio buffer, for Bluetooth crackle        // user latency trim, seconds
    this.metroPlay = false;
    this.localSound = true;
    this.midiOut = null;
    this.viz = [];             // things the UI should animate, in time order
    this.listeners = new Set();
    this.held = new Map();
    this.heldFx = new Map();
    this.nid = 0;
    this.pass = 0;
    this.seg = null;
    this.prevSeg = null;
    this.timer = null;
    this.undoMark = '';
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { this.listeners.forEach((fn) => fn(type, data)); }

  get ready() { return !!(this.ctx && this.g && this.ctx.state === 'running'); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  // Call from a user gesture: browsers will not start audio otherwise.
  async wake(project) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const big = this.smooth === 'on';
      this.ctx = new AC({ latencyHint: big ? 'playback' : 'interactive' });
      this.bigBuffer = big;
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (e) { /* will retry on next touch */ }
    }
    if (!this.g || this.project !== project) {
      // several first touches can land at once; let them share one load
      if (!this.loading || this.loadingFor !== project) {
        this.loadingFor = project;
        this.loading = this.load(project).finally(() => { this.loading = null; });
      }
      await this.loading;
    }
  }

  // Throw the audio context away and start a new one (buffer size change).
  async reopen() {
    const p = this.project;
    if (this.playing) this.stop();
    if (this.ctx) { try { await this.ctx.close(); } catch (e) { /* already closed */ } }
    this.ctx = null; this.g = null;
    if (p) await this.wake(p);
  }

  async load(project) {
    if (this.playing) this.stop();
    if (this.g) { try { this.g.master.output.disconnect(); } catch (e) { /* gone */ } }
    this.project = project;
    if (!this.ctx) return;
    const kit = await getKit(this.ctx.sampleRate, project.key);
    try { await ensureSamples(sampleIds(project)); } catch (e) { /* storage unavailable: sampler tracks stay silent */ }
    this.g = buildGraph(this.ctx, project, kit);
    this.g.master.output.gain.value = this.localSound ? 1 : 0;
    this.applyLatches();
    this.refreshMutes();
    if (this.midiOut && this.midiOut.syncAll) this.midiOut.syncAll();
    this.idleNext = this.ctx.currentTime;
    this.idleIdx = 0;
    if (!this.timer) this.timer = setInterval(() => this.tick(), INTERVAL);
  }

  suspend() {
    if (this.playing) this.stop();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  // ---------- time ----------

  get spt() { return 60 / (this.project.bpm * PPQ); }
  tickAt(time) { return this.aTick + (time - this.aTime) / this.spt; }
  timeAt(tick) { return this.aTime + (tick - this.aTick) * this.spt; }
  latency() {
    const c = this.ctx;
    return (c.outputLatency || c.baseLatency || 0) + this.tapOffset;
  }

  setBpm(bpm) {
    const p = this.project;
    if (this.playing) {
      // re-anchor at the scheduling frontier so nothing already queued moves
      const t = this.timeAt(this.sched);
      p.bpm = bpm;
      this.aTick = this.sched;
      this.aTime = t;
    } else {
      p.bpm = bpm;
    }
    if (this.g) this.g.eachRack((r) => r.setTempo(bpm, this.now));
  }

  async setKey() {
    if (!this.g) return;
    this.g.kit = await getKit(this.ctx.sampleRate, this.project.key);
  }

  syncTrack(track) { if (this.g) this.g.syncTrack(track); if (this.midiOut && this.midiOut.syncTrack) this.midiOut.syncTrack(track); }
  syncAll() { if (this.g) this.project.tracks.forEach((t) => this.g.syncTrack(t)); if (this.midiOut && this.midiOut.syncAll) this.midiOut.syncAll(); }
  removeTrack(id) { if (this.g) this.g.removeTrack(id); }
  setMaster(id) { this.project.master = id; if (this.g) this.g.master.set(id); }
  setSpace(space) { this.project.space = space; if (this.g) this.g.rack.setSpace(space); }
  setLocalSound(on) {
    this.localSound = !!on;
    if (this.g) this.g.master.output.gain.setTargetAtTime(this.localSound ? 1 : 0, this.now, 0.01);
  }

  // ---------- transport ----------

  play({ record = false, countIn = false } = {}) {
    if (!this.ready) return;
    const p = this.project;
    if (this.playing) this.stop(true);
    this.g.eachRack((r) => r.setTempo(p.bpm, this.now));
    const song = this.mode === 'song' && p.song.length > 0;
    if (song) {
      this.segs = songSegments(p, this.songFrom).map((s) => ({ ...s, pass: ++this.pass }));
      const shift = this.segs[0].start;
      const blockShift = this.segs[0].blockStart;
      for (const s of this.segs) { s.start -= shift; s.blockStart -= blockShift; }
      // blockStart of the first block may now sit before 0; that is fine
      this.segIdx = 0;
      this.seg = this.segs[0];
    } else {
      this.segs = null;
      this.seg = this.loopSeg(p.cur, 0);
    }
    this.prevSeg = null;
    this.ending = null;
    this.queued = null;
    this.aTime = this.now + 0.07;
    this.aTick = countIn ? -BAR : 0;
    this.sched = this.aTick;
    this.playing = true;
    this.recording = record;
    this.undoMark = '';
    if (this.midiOut && this.midiOut.start) this.midiOut.start();
    this.emit('transport');
    this.tick();
  }

  loopSeg(secIdx, start) {
    return { secIdx, start, len: this.project.sections[secIdx].bars * BAR, off: null, block: -1, blockStart: 0, pass: ++this.pass };
  }

  stop(quiet = false) {
    if (!this.playing) return;
    const now = this.now;
    this.finishHeld(now);
    this.playing = false;
    this.recording = false;
    this.queued = null;
    this.g.killAll(now);
    this.g.eachRack((r) => r.reset(now));
    if (this.midiOut && this.midiOut.stop) this.midiOut.stop();
    this.applyLatches();
    this.viz.length = 0;
    this.idleNext = now;
    if (!quiet) this.emit('transport');
  }

  setRecording(on) {
    this.recording = on && this.playing;
    this.undoMark = '';
    this.emit('transport');
  }

  // Switch section: at once when stopped, on the next loop boundary when playing.
  setSection(idx) {
    const p = this.project;
    if (idx < 0 || idx >= p.sections.length) return;
    if (this.playing && this.mode === 'loop') {
      this.queued = idx === p.cur ? null : idx;
      this.emit('queue');
    } else {
      p.cur = idx;
      this.refreshMutes();
      this.emit('section');
    }
  }

  applyLatches() {
    const latch = this.project.latch || {};
    for (const k of Object.keys(latch)) if (latch[k]) this.g.rack.on(k, latch[k].p, this.now);
  }

  setLatch(k, on, p) {
    const latch = this.project.latch;
    if (on) latch[k] = { p: p ?? null }; else delete latch[k];
    if (!this.g) return;
    if (on) this.g.rack.on(k, p, this.now);
    else if (!this.heldFx.has(k + '|')) this.g.rack.off(k, this.now);
  }

  // ---------- scheduler ----------

  tick() {
    if (!this.ready) return;
    const g = this.g, p = this.project, now = this.now;
    if (!this.playing) {
      // keep a free-running 16th clock so Glitch and Squish work while jamming
      const dur = (60 / p.bpm) / 4;
      if (this.idleNext < now - 0.5) this.idleNext = now;
      while (this.idleNext < now + LOOKAHEAD) {
        g.eachRack((r) => r.tick(this.idleIdx, this.idleNext, dur));
        this.idleIdx++;
        this.idleNext += dur;
      }
      return;
    }
    if (this.ending != null) {
      if (this.tickAt(now) >= this.ending) { this.stop(); this.emit('songend'); }
      return;
    }
    const horizon = this.tickAt(now + LOOKAHEAD);
    const timeAt = (tk) => this.timeAt(tk);
    const click = (step, time) => {
      if (step % 4) return;
      const beat = step / 4;
      if (p.metro && (this.recording || this.metroPlay)) g.click(time, beat % 4 === 0);
    };

    while (this.sched < horizon) {
      if (this.sched < 0) {
        // count-in bar
        const end = Math.min(horizon, 0);
        for (let s = Math.ceil(this.sched / STEP); s * STEP < end; s++) {
          if (s % 4) continue;
          const time = this.timeAt(s * STEP);
          g.click(time, s === -16);
          this.viz.push({ time, kind: 'count', n: -s / 4 });
        }
        this.sched = end;
        continue;
      }
      let seg = this.seg;
      if (this.sched >= seg.start + seg.len) {
        seg = this.advance(seg);
        if (!seg) break;
      }
      const end = Math.min(horizon, seg.start + seg.len);
      scheduleRange(g, p, seg, this.sched - seg.start, end - seg.start, timeAt, {
        onNote: (track, ev, time, gain = 1) => {
          this.viz.push({ time, kind: 'note', track: track.id, r: ev.r, c: ev.c, d: ev.d * this.spt });
          if (this.midiOut && this.midiOut.scheduleNote) this.midiOut.scheduleNote(track, ev, time, this.now, ev.d * this.spt, gain);
        },
        onStep: (step, time) => {
          click(step, time);
          this.viz.push({ time, kind: 'step', step, seg });
          if (this.midiOut && this.midiOut.clockStep) this.midiOut.clockStep(time, this.now, this.spt);
        },
      });
      this.sched = end;
    }
  }

  advance(seg) {
    const p = this.project;
    const start = seg.start + seg.len;
    let next;
    if (this.segs) {
      this.segIdx++;
      if (this.segIdx >= this.segs.length) {
        if (!this.loopSong) { this.ending = start; return null; }
        const fresh = songSegments(p, 0);
        this.segs = fresh.map((s) => ({ ...s, start: s.start + start, blockStart: s.blockStart + start, pass: ++this.pass }));
        this.segIdx = 0;
      }
      next = this.segs[this.segIdx];
    } else {
      let idx = seg.secIdx;
      if (this.queued != null) { idx = this.queued; this.queued = null; }
      if (idx >= p.sections.length) idx = 0;
      next = this.loopSeg(idx, start);
      if (idx !== p.cur) {
        p.cur = idx;
        this.refreshMutes();
        this.viz.push({ time: this.timeAt(start), kind: 'section', idx });
      }
    }
    this.prevSeg = seg;
    this.seg = next;
    this.undoMark = '';
    return next;
  }

  // Segment that is sounding at a given tick (the scheduler runs slightly ahead).
  segAtTick(tick) {
    if (this.seg && tick >= this.seg.start) return this.seg;
    if (this.prevSeg && tick >= this.prevSeg.start) return this.prevSeg;
    return this.seg;
  }

  // Where the playhead is right now: { seg, local, len, block } or null.
  position() {
    if (!this.playing) return null;
    const tick = this.tickAt(this.now - (this.ctx.outputLatency || 0));
    if (tick < 0) return { countIn: true, tick };
    const seg = this.segAtTick(tick);
    return { seg, local: Math.min(seg.len, tick - seg.start), len: seg.len, block: seg.block };
  }

  // Hand the UI everything due up to `time`.
  drainViz(time) {
    const out = [];
    while (this.viz.length && this.viz[0].time <= time) out.push(this.viz.shift());
    return out;
  }

  // ---------- playing by hand ----------

  recSlot(time) {
    // Returns { seg, local } for a press at context time `time`, or null.
    if (!this.recording || !this.playing) return null;
    let tick = this.tickAt(time - this.latency());
    if (tick < 0) {
      if (tick < -STEP * 2) return null;     // far too early in the count-in
      tick = 0;
    }
    const seg = this.segAtTick(tick);
    return { seg, local: swingUnwarp(Math.max(0, tick - seg.start), this.project.swing) };
  }

  markUndo(key) {
    // one undo step per track per loop pass
    if (this.undoMark === key) return;
    this.undoMark = key;
    pushUndo(this.project);
  }

  noteOn(track, row, col, vel = 0.85, opts = {}) {
    if (!this.ready) return 0;
    const now = this.now;
    const drums = track.role === 'drums';
    const chord = drums ? undefined : chordOf(track, col);
    const acc = drums ? 0 : (opts.acc !== undefined ? opts.acc : this.acc);
    const handles = this.g.playCell(track, row, col, chord, vel, now, undefined, acc);
    const id = ++this.nid;
    if (this.midiOut && this.midiOut.noteOn) this.midiOut.noteOn(id, track, row, col, chord, vel, acc);
    const h = { handles, rec: null };
    const slot = this.mode === 'loop' ? this.recSlot(now) : null;
    if (slot) {
      const p = this.project, { seg } = slot;
      let q = quantizeTick(slot.local, p.quant);
      let pass = seg.pass;
      if (q >= seg.len) { q -= seg.len; pass = seg.pass + 1; }
      this.markUndo(`${track.id}:${seg.pass}`);
      const sec = p.sections[seg.secIdx];
      const list = sec.ev[track.id] || (sec.ev[track.id] = []);
      const dupe = list.findIndex((e) => e.t === q && e.r === row && e.c === col);
      if (dupe >= 0) list.splice(dupe, 1);
      const ev = { t: q, d: STEP, r: row, c: col, v: Math.round(vel * 100) / 100 };
      if (chord && chord !== 'off') ev.ch = chord;
      if (acc) ev.a = acc;
      ev._p = pass;
      insertSorted(list, ev);
      if (!drums) h.rec = { ev, seg, start: slot.local };
      this.emit('edit');
    }
    this.held.set(id, h);
    return id;
  }

  // Pitch-bend a held note (finger wiggling up and down on its bubble).
  bend(id, cents) {
    const h = this.held.get(id);
    if (!h) return;
    const now = this.now;
    h.handles.forEach((x) => x.bend && x.bend(cents, now));
    if (this.midiOut && this.midiOut.bend) this.midiOut.bend(id, cents);
    if (h.rec) {
      // keep the gesture with the note: [ticks after the note starts, cents]
      const { ev, seg, start } = h.rec;
      const at = Math.max(0, Math.round(this.tickAt(now - this.latency()) - seg.start - start));
      const b = ev.b || (ev.b = []);
      const last = b[b.length - 1];
      if (last && at - last[0] < 3) last[1] = Math.round(cents);
      else if (b.length < 200) b.push([at, Math.round(cents)]);
    }
  }

  // Loop mode follows the current section's mutes; song mode uses the blocks'.
  refreshMutes() {
    if (!this.g) return;
    const p = this.project, m = (this.mode === 'loop' && p.sections[p.cur].mute) || {};
    this.g.mutedIds = new Set(Object.keys(m).filter((k) => m[k]));
    this.syncAll();
  }

  noteOff(id) {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    const now = this.now;
    h.handles.forEach((x) => x.release(now));
    if (this.midiOut && this.midiOut.noteOff) this.midiOut.noteOff(id);
    this.closeRec(h, now);
  }

  closeRec(h, now) {
    if (!h.rec) return;
    const { ev, seg, start } = h.rec;
    const end = swingUnwarp(Math.max(0, this.tickAt(now - this.latency()) - seg.start), this.project.swing);
    ev.d = Math.round(Math.min(seg.len, Math.max(STEP / 2, end - start)));
    h.rec = null;
    this.emit('edit');
  }

  finishHeld(now) {
    for (const h of this.held.values()) this.closeRec(h, now);
    for (const [key, f] of this.heldFx) this.closeFx(key.split('|')[0], f, now);
  }

  // ---------- quick-hit FX ----------

  fxDown(k, p, tr = null) {
    if (!this.ready) return;
    const now = this.now;
    const key = k + '|' + (tr || '');
    if (this.heldFx.has(key)) this.fxUp(k, tr);
    const rack = this.g.fxRack(tr);
    if (!rack) return;
    rack.on(k, p, now);
    const f = { p, tr, rack, rec: null };
    const slot = this.recSlot(now);
    if (slot) {
      const proj = this.project, { seg } = slot;
      const song = seg.block >= 0;
      const lane = song ? proj.song[seg.block].fx : proj.sections[seg.secIdx].fx;
      const span = song ? this.blockLen(seg.block) : seg.len;
      const base = song ? seg.start - seg.blockStart : 0;
      let t = base + quantizeTick(slot.local, proj.quant ? STEP : 0);
      if (t >= span) t -= span;
      this.markUndo(`fx:${seg.pass}`);
      const ev = { t, d: STEP, k };
      if (p != null) ev.p = p;
      if (tr) ev.tr = tr;
      ev._p = seg.pass;
      insertSorted(lane, ev);
      f.rec = { ev, seg, start: base + slot.local, span, lane };
      this.emit('edit');
    }
    this.heldFx.set(key, f);
  }

  fxUp(k, tr = null) {
    const key = k + '|' + (tr || '');
    const f = this.heldFx.get(key);
    if (!f) return;
    this.heldFx.delete(key);
    const now = this.now;
    if (tr || !(this.project.latch && this.project.latch[k])) f.rack.off(k, now);
    this.closeFx(k, f, now);
  }

  closeFx(k, f, now) {
    if (!f.rec) return;
    const { ev, seg, start, span, lane } = f.rec;
    const base = seg.block >= 0 ? seg.start - seg.blockStart : 0;
    const end = base + swingUnwarp(Math.max(0, this.tickAt(now - this.latency()) - seg.start), this.project.swing);
    ev.d = Math.round(Math.min(span, Math.max(STEP / 2, end - start)));
    // fold together overlapping hits of the same effect
    for (let i = lane.length - 1; i >= 0; i--) {
      const o = lane[i];
      if (o === ev || o.k !== k || o.p !== ev.p || o.tr !== ev.tr) continue;
      if (o.t < ev.t + ev.d && ev.t < o.t + o.d) {
        const a = Math.min(o.t, ev.t), b = Math.max(o.t + o.d, ev.t + ev.d);
        ev.t = a; ev.d = b - a;
        lane.splice(i, 1);
      }
    }
    lane.sort((x, y) => x.t - y.t);
    f.rec = null;
    this.emit('edit');
  }

  blockLen(block) {
    const b = this.project.song[block];
    return this.project.sections[b.sec].bars * BAR * b.rep;
  }
}
