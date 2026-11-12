// Renders every instrument and every drum pad on its own and checks that
// each one makes sound, stays finite, and sits at a sensible level.
// Pass --wav to also write the audio into tests/.out for listening.

import path from 'node:path';
import { serve, openPage, pullChannels, writeWav, stats, OUT } from './lib.mjs';

const keep = process.argv.includes('--wav');
const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('  FAIL ' + msg); } };

await page.evaluate(async () => {
  const state = await import('/js/state.js');
  const { renderProject } = await import('/js/render.js');
  const { INSTRUMENTS } = await import('/js/instruments.js');
  const { DRUM_PADS } = await import('/js/drums.js');
  window.T = { state, renderProject, INSTRUMENTS, DRUM_PADS };
  window.soloProject = (instId, events, role) => {
    const p = state.newProject('t');
    p.bpm = 120;
    const inst = INSTRUMENTS.find((i) => i.id === instId);
    const r = role || (instId === 'drums' ? 'drums' : inst.roles[0]);
    const track = p.tracks.find((t) => t.role === r);
    track.inst = instId; track.rev = 0; track.dly = 0; track.pan = 0; track.chord = 'off';
    p.tracks = [track];
    p.sections[0].bars = 2;
    p.sections[0].ev = { [track.id]: events };
    return p;
  };
});

console.log('instrument        peak dB   rms dB');
const instruments = await page.evaluate(() => window.T.INSTRUMENTS.filter((i) => i.voice).map((i) => i.id));
for (const id of instruments) {
  // a held triad, then three single notes up the grid
  const r = await pullChannels(page, `(async () => {
    const ev = [
      { t: 0, d: 180, r: 1, c: 0, v: 0.85, ch: 'triad' },
      { t: 192, d: 40, r: 1, c: 2, v: 0.85 }, { t: 240, d: 40, r: 2, c: 0, v: 0.85 }, { t: 288, d: 90, r: 2, c: 3, v: 0.85 },
      { t: 384, d: 300, r: 0, c: 0, v: 0.85 },
    ];
    return window.T.renderProject(window.soloProject('${id}', ev), { what: 'loop', passes: 1, master: false });
  })()`);
  const s = stats(r.channels[0]);
  console.log(`${id.padEnd(16)} ${String(s.peakDb).padStart(7)}  ${String(s.rmsDb).padStart(7)}`);
  check(s.bad === 0, `${id}: non-finite samples`);
  check(s.peak > 0.02, `${id}: silent`);
  check(s.peak < 1.0, `${id}: too hot (${s.peak.toFixed(2)})`);
  if (keep) writeWav(path.join(OUT, `inst-${id}.wav`), r.channels, r.sampleRate);
}

console.log('\ndrum pad          peak dB   rms dB');
const pads = await page.evaluate(() => window.T.DRUM_PADS.map((p) => p.id));
for (let i = 0; i < pads.length; i++) {
  const r = await pullChannels(page, `(async () => {
    const ev = [{ t: 0, d: 24, r: ${Math.floor(i / 5)}, c: ${i % 5}, v: 1 }];
    return window.T.renderProject(window.soloProject('drums', ev), { what: 'loop', passes: 1, master: false });
  })()`);
  const s = stats(r.channels[0]);
  console.log(`${pads[i].padEnd(16)} ${String(s.peakDb).padStart(7)}  ${String(s.rmsDb).padStart(7)}`);
  check(s.bad === 0, `${pads[i]}: non-finite samples`);
  check(s.peak > 0.02, `${pads[i]}: silent`);
  check(s.peak < 1.0, `${pads[i]}: too hot`);
  if (keep) writeWav(path.join(OUT, `drum-${String(i).padStart(2, '0')}-${pads[i]}.wav`), r.channels, r.sampleRate);
}

check(errors.length === 0, 'page errors: ' + errors.join(' | '));
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall sounds ok');
process.exit(failed ? 1 : 0);
