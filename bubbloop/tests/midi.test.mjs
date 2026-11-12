// Web MIDI controller tests, run in plain Node with a mocked MIDIAccess.

import { MidiController, mapInputNote, channelForTrack, centsToBend14, bend14ToCents, notesForCell } from '../web/js/midi.js';
import { cellNotes, ROWS, COLS } from '../web/js/theory.js';
import { newProject, makeTrack } from '../web/js/state.js';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };

console.log('Pitch bend math');
{
  const [l0, m0] = centsToBend14(0);
  check(l0 === 0 && m0 === 64, '0 cents -> center 8192');
  const [lh, mh] = centsToBend14(200);
  check(((mh << 7) | lh) === 16383, '+200 cents -> 16383');
  const [ll, ml] = centsToBend14(-200);
  check(ll === 0 && ml === 0, '-200 cents -> 0');
  check(Math.abs(bend14ToCents((mh << 7) | lh) - 200) < 0.05, 'round-trip +200 cents');
  check(Math.abs(bend14ToCents(8192)) < 0.01, 'round-trip 0 cents');
}

console.log('Channel routing');
{
  const p = newProject('Ch');
  while (p.tracks.length < 11) p.tracks.push(makeTrack('melody'));
  check(channelForTrack(p, p.tracks[1]) === 0, 'first melodic track -> ch 0');
  check(channelForTrack(p, p.tracks.find((t) => t.role === 'drums')) === 9, 'drums -> ch 9');
  const melodic = p.tracks.filter((t) => t.role !== 'drums');
  check(channelForTrack(p, melodic[9]) === 10, '10th melodic track skips drum ch 9 -> ch 10');
}

console.log('Note mapping');
{
  const p = newProject('Map');
  p.key = 0; p.scale = 'major';
  const [drums, bass, , melody] = p.tracks;

  const c4 = mapInputNote(p, melody, 60, { inputMode: 'chromatic' });
  check(c4.r === 1 && c4.c === 0 && c4.acc === 0, 'C4 maps exactly to row 1 col 0');

  const f4 = mapInputNote(p, melody, 65, { inputMode: 'chromatic' });
  check(cellNotes(p, melody, f4.r, f4.c, 'off', f4.acc)[0] === 65, 'F4 chromatic preserves exact MIDI pitch 65');

  const f4Snap = mapInputNote(p, melody, 65, { inputMode: 'scale' });
  check(f4Snap.acc === 0 && cellNotes(p, melody, f4Snap.r, f4Snap.c, 'off', 0)[0] === 64, 'F4 scale-snap snaps to E4 in C major pentatonic');

  const lowC = mapInputNote(p, melody, 36, { inputMode: 'chromatic' });
  check(lowC.r === 0 && lowC.c === 0 && lowC.acc === 0, 'out-of-range C2 folds up to row 0 col 0');

  const kick = mapInputNote(p, drums, 36, { drumMode: 'gm' });
  const snare = mapInputNote(p, drums, 38, { drumMode: 'gm' });
  const ohat = mapInputNote(p, drums, 46, { drumMode: 'gm' });
  check(kick.r === 0 && kick.c === 0, 'GM 36 -> Boom kick (0,0)');
  check(snare.r === 0 && snare.c === 2, 'GM 38 -> Crack snare (0,2)');
  check(ohat.r === 1 && ohat.c === 3, 'GM 46 -> Tsss open hat (1,3)');

  const gridTop = mapInputNote(p, drums, 60, { drumMode: 'grid' });
  check(gridTop.r === ROWS - 1 && gridTop.c === COLS - 1, 'grid mode 60 -> top-right (4,4)');

  const kit = makeTrack('melody', 'sampler');
  kit.smp = { mode: 'kit', key: null, kit: {} };
  const kitPad = mapInputNote(p, kit, 42);
  check(kitPad.r === 1 && kitPad.c === 1, 'sampler kit 42 -> pad (1,1)');
  check(notesForCell(p, drums, 0, 0)[0] === 36, 'drum cell (0,0) outputs GM 36');
}

console.log('MidiController I/O');
{
  const p = newProject('Live');
  let curTrack = p.tracks[3];
  const st = { inId: 'all', outId: 'out-1', inputMode: 'chromatic', drumMode: 'gm', routing: 'omni', localSound: true, clockOut: true };
  const sent = [];
  const events = [];
  let nextId = 1;

  const inputPort = { id: 'in-1', name: 'Test Keyboard', manufacturer: 'Acme', state: 'connected', onmidimessage: null };
  const outputPort = {
    id: 'out-1', name: 'Test Synth', manufacturer: 'Acme', state: 'connected',
    send(bytes, ts) { sent.push({ bytes: [...bytes], ts }); },
  };
  const fakeNav = {
    async requestMIDIAccess() {
      return {
        inputs: new Map([['in-1', inputPort]]),
        outputs: new Map([['out-1', outputPort]]),
        onstatechange: null,
      };
    },
  };

  const midi = new MidiController({
    getProject: () => p,
    getCurTrack: () => curTrack,
    getSettings: () => st,
    onNoteOn: (e) => { events.push({ kind: 'on', ...e }); return nextId++; },
    onNoteOff: (id) => { events.push({ kind: 'off', id }); },
    onBend: (id, cents) => { events.push({ kind: 'bend', id, cents }); },
  });

  const ok = await midi.connect(fakeNav);
  check(ok && midi.connected, 'connects with mock MIDIAccess');
  check(midi.inputs().length === 1 && midi.outputs().length === 1, 'lists connected ports');
  check(sent.some((m) => m.bytes[0] === 0xc2), 'sends Program Change on connect');

  // Incoming Note On + Sustain + Note Off + Sustain Release
  inputPort.onmidimessage({ data: new Uint8Array([0x90, 60, 100]) });
  check(events.length === 1 && events[0].kind === 'on' && events[0].r === 1 && events[0].c === 0, 'Note On triggers grid cell');

  inputPort.onmidimessage({ data: new Uint8Array([0xe0, 0, 127]) });
  check(events.some((e) => e.kind === 'bend' && e.cents > 190), 'Pitch Bend forwards cents to held note');

  inputPort.onmidimessage({ data: new Uint8Array([0xb0, 64, 127]) }); // sustain down
  inputPort.onmidimessage({ data: new Uint8Array([0x80, 60, 0]) });   // key released while sustain held
  check(!events.some((e) => e.kind === 'off'), 'Sustain pedal holds note after key release');

  inputPort.onmidimessage({ data: new Uint8Array([0xb0, 64, 0]) });   // sustain up
  check(events.some((e) => e.kind === 'off' && e.id === 1), 'Releasing sustain sends Note Off');

  // Channel routing -> ch 9 targets drums
  st.routing = 'channel';
  inputPort.onmidimessage({ data: new Uint8Array([0x99, 36, 110]) });
  const drumEv = events.find((e) => e.kind === 'on' && e.track.role === 'drums');
  check(!!drumEv && drumEv.r === 0 && drumEv.c === 0, 'Channel 10 (0x99) routes to drums track');

  // Outgoing live & scheduled notes + clock
  sent.length = 0;
  midi.start();
  check(sent.some((m) => m.bytes[0] === 0xfa), 'start() sends MIDI Start 0xFA');
  midi.clockStep(1.0, 0.9, 60 / (120 * 96));
  check(sent.filter((m) => m.bytes[0] === 0xf8).length === 6, 'clockStep() sends 6 MIDI Clock ticks per 16th');

  midi.noteOn(55, p.tracks[3], 1, 0, 'off', 0.8, 0);
  check(sent.some((m) => (m.bytes[0] & 0xf0) === 0x90 && m.bytes[1] === 60), 'noteOn() sends MIDI Note On');
  midi.noteOff(55);
  check(sent.some((m) => (m.bytes[0] & 0xf0) === 0x80 && m.bytes[1] === 60), 'noteOff() sends MIDI Note Off');

  sent.length = 0;
  midi.scheduleNote(p.tracks[2], { r: 1, c: 0, v: 0.75, ch: 'triad', a: 0 }, 1.0, 0.9, 0.5, 1);
  check(sent.filter((m) => (m.bytes[0] & 0xf0) === 0x90).length === 3, 'scheduleNote() sends triad as 3 Note Ons');
  check(sent.filter((m) => (m.bytes[0] & 0xf0) === 0x80).length === 3, 'scheduleNote() schedules 3 Note Offs');

  midi.stop();
  check(sent.some((m) => m.bytes[0] === 0xfc) && sent.some((m) => m.bytes[1] === 123), 'stop() sends All Notes Off + MIDI Stop');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall MIDI checks passed');
process.exit(failed ? 1 : 0);
