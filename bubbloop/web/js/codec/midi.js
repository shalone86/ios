// Standard MIDI File export: one track per instrument, so a sketch can be
// dropped into a DAW and every part re-voiced or edited there.

import { PPQ, cellNotes } from '../theory.js';
import { padFor } from '../drums.js';
import { instrumentById } from '../instruments.js';
import { songSegments, loopSegments, swingWarp, withFill } from '../seq.js';

const DIVISION = 480;
const SCALE = DIVISION / PPQ;

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const str = (s) => Array.from(new TextEncoder().encode(s));
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v) => [(v >>> 8) & 255, v & 255];
// cents -> 14-bit pitch bend (centre 8192) for a +-2 semitone range
const bendBytes = (ch, cents) => {
  const v = Math.max(0, Math.min(16383, Math.round(8192 + (cents / 200) * 8192)));
  return [0xe0 | ch, v & 127, v >> 7];
};

function chunk(events, endTick) {
  // events: { t, order, bytes }
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    const t = Math.max(last, Math.round(e.t));
    body.push(...vlq(t - last), ...e.bytes);
    last = t;
  }
  body.push(...vlq(Math.max(0, Math.round(endTick) - last)), 0xff, 0x2f, 0x00);
  return [...str('MTrk'), ...u32(body.length), ...body];
}

export function encodeMidi(project, what = 'song') {
  const p = project;
  const segs = what === 'song' && p.song.length ? songSegments(p) : loopSegments(p, p.cur, 1);
  const last = segs[segs.length - 1];
  const end = (last.start + last.len) * SCALE;
  const usPerBeat = Math.round(60000000 / p.bpm);

  const tracks = [];
  tracks.push(chunk([
    { t: 0, order: 0, bytes: [0xff, 0x03, ...vlq(str(p.name).length), ...str(p.name)] },
    { t: 0, order: 1, bytes: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255] },
    { t: 0, order: 2, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ], end));

  let nextChannel = 0;
  for (const track of p.tracks) {
    const inst = instrumentById(track.inst);
    const drums = inst.id === 'drums';
    let ch = 9;
    if (!drums) {
      if (nextChannel === 9) nextChannel++;
      ch = nextChannel++ % 16;
    }
    const name = `${track.name} (${inst.name})`;
    const ev = [{ t: 0, order: 0, bytes: [0xff, 0x03, ...vlq(str(name).length), ...str(name)] }];
    if (!drums) {
      ev.push({ t: 0, order: 1, bytes: [0xc0 | ch, inst.gm] });
      // RPN 0: pitch-bend range = 2 semitones, so bends in cents map exactly
      for (const [cc, v] of [[101, 0], [100, 0], [6, 2], [38, 0]]) ev.push({ t: 0, order: 1, bytes: [0xb0 | ch, cc, v] });
    }
    for (const seg of segs) {
      if (seg.off && seg.off[track.id]) continue;
      const sec = p.sections[seg.secIdx];
      if (seg.block < 0 && sec.mute && sec.mute[track.id]) continue;   // a section's own mutes
      let evs = sec.ev[track.id] || [];
      // block "spice", as in scheduleRange: an energy change and a closing fill
      const sp = seg.sp && seg.sp[track.id];
      const gain = sp && sp.vel ? sp.vel : 1;
      if (sp && sp.fill && seg.last) evs = withFill(track, evs, seg.len, sp.fill);
      for (const e of evs) {
        const on = (seg.start + swingWarp(e.t, p.swing)) * SCALE;
        const off = on + Math.max(1, e.d * SCALE - 1);
        const vel = Math.max(1, Math.min(127, Math.round(Math.min(1, e.v * gain) * 127)));
        // recorded bends ride the channel with the note, then recentre
        if (!drums && e.b && e.b.length) {
          for (const [dt, cents] of e.b) {
            const bt = on + dt * SCALE;
            if (bt < off) ev.push({ t: bt, order: 2.6, bytes: bendBytes(ch, cents) });
          }
          ev.push({ t: off, order: 2.4, bytes: bendBytes(ch, 0) });
        }
        const notes = drums ? [padFor(track, e.r, e.c).pad.gm] : cellNotes(p, track, e.r, e.c, e.ch, e.a);
        for (const n of notes) {
          if (n < 0 || n > 127) continue;
          ev.push({ t: on, order: 3, bytes: [0x90 | ch, n, vel] });
          ev.push({ t: off, order: 2, bytes: [0x80 | ch, n, 0] });
        }
      }
    }
    tracks.push(chunk(ev, end));
  }

  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(DIVISION)];
  return Uint8Array.from([...header, ...tracks.flat()]);
}
