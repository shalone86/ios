// End-to-end test of the app in headless Chromium at phone size: play
// bubbles, record a loop, drop in a groove, build a song, export files.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, openPage, OUT, measureLufs } from './lib.mjs';

const server = await serve();
const { browser, context, page, errors } = await openPage(server.url + '/index.html', {
  viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true,
});
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.startsWith('export-')) fs.rmSync(path.join(OUT, f));
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };
const shot = (n) => page.screenshot({ path: path.join(OUT, `app-${n}.png`) });
const wait = (ms) => page.waitForTimeout(ms);
const state = (fn) => page.evaluate(fn);

// Press and hold a bubble with a real pointer sequence.
async function tap(r, c, holdMs = 90) {
  const box = await page.locator(`#grid .cell[data-r="${r}"][data-c="${c}"]`).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(([x, y, holdMs]) => new Promise((done) => {
    const el = document.elementFromPoint(x, y);
    const id = 100 + Math.floor(Math.random() * 1e6);
    const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
    fire('pointerdown');
    setTimeout(() => { fire('pointerup'); done(); }, holdMs);
  }), [x, y, holdMs]);
}
// DOM click: sheets slide in, so there is no stable geometry to aim at
const click = async (sel) => { await page.waitForSelector(sel, { state: 'attached', timeout: 10000 }); await page.locator(sel).first().evaluate((el) => el.click()); };

console.log('Start');
check(await page.locator('#btn-tour').isVisible(), 'first visit: the start screen offers the tutorial');
await click('#btn-tour');
check(await page.locator('#tour').isVisible() && /media\/tutorial\.mp4$/.test(await page.locator('#tour-video').getAttribute('src')), 'the tutorial opens in a full-screen player');
await click('#tour-close');
check(!(await page.locator('#tour').isVisible()), 'and closes');
await click('#btn-start');
await page.waitForFunction(() => window.bubbloop && window.bubbloop.engine.ready, null, { timeout: 15000 });
check(true, 'audio engine wakes up');
check(await page.locator('#grid .cell').count() === 25, '25 bubbles on the grid');

console.log('Jam');
await tap(1, 0); await tap(1, 2); await tap(2, 4);
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length) === 0, 'jamming without record leaves the loop empty');

console.log('Mashing every bubble at once');
{
  const res = await page.evaluate(async () => {
    const cells = [...document.querySelectorAll('#grid .cell')];
    const fire = (el, type, id, primary) => {
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true }));
    };
    // ten fingers land; only some lifts get reported, like a mash on an iPad
    for (let i = 0; i < 10; i++) fire(cells[(i * 7) % 25], 'pointerdown', 500 + i, i === 0);
    for (let i = 0; i < 10; i += 3) fire(cells[(i * 7) % 25], 'pointerup', 500 + i, i === 0);
    // a finger id reused for a new touch without its old lift
    fire(cells[3], 'pointerdown', 504, false);
    await new Promise((r) => setTimeout(r, 50));
    const heldDuring = window.bubbloop.engine.held.size;
    // then a single, fresh tap
    fire(cells[12], 'pointerdown', 900, true);
    await new Promise((r) => setTimeout(r, 60));
    const heldTap = window.bubbloop.engine.held.size;
    fire(cells[12], 'pointerup', 900, true);
    await new Promise((r) => setTimeout(r, 60));
    return { heldDuring, heldTap, heldAfter: window.bubbloop.engine.held.size, lit: document.querySelectorAll('#grid .cell.on').length };
  });
  check(res.heldTap === 1, `after a mash, a fresh tap plays exactly one note (${res.heldTap} held; ${res.heldDuring} were stuck before it)`);
  check(res.heldAfter === 0 && res.lit === 0, `and nothing is left stuck when it lifts (${res.heldAfter} held, ${res.lit} lit)`);
}

console.log('Record a loop');
await state(() => { window.bubbloop.project.bpm = 150; window.bubbloop.engine.setBpm(150); });
await click('#btn-rec');
await wait(350);
check((await page.locator('#count').innerText()).trim().length > 0, 'count-in is showing');
await page.waitForFunction(() => { const p = window.bubbloop.engine.position(); return p && !p.countIn; }, null, { timeout: 8000 });
check(await state(() => window.bubbloop.engine.recording), 'recording after the count-in');
for (const [r, c] of [[1, 0], [1, 2], [1, 4], [2, 1]]) { await tap(r, c, 120); await wait(160); }
await shot('1-recording');
const recorded = await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].map((e) => ({ ...e })));
check(recorded.length === 4, `four notes recorded (${recorded.length})`);
check(recorded.every((e) => e.t % 24 === 0), 'notes snapped to 16ths');
check(recorded.every((e) => e.d >= 12), 'held lengths captured');
// let it loop round once: nothing should be added by playback itself
await wait(3600);
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length) === 4, 'loop plays back without duplicating notes');
check(await page.locator('#grid .cell.has').count() === 4, 'bubbles holding notes are badged');

console.log('Add drums while it loops');
await click('.pod[data-track]:nth-child(1)');
check(await page.locator('#grid .cell .lbl').first().innerText() === 'Rain', 'grid switches to the drum kit');
await tap(0, 0); await wait(200); await tap(0, 2);
const drumTrack = await state(() => window.bubbloop.trackId);
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length) === 2, 'drum hits overdubbed on the same loop');
await click('#btn-rec');
check(!(await state(() => window.bubbloop.engine.recording)) && await state(() => window.bubbloop.engine.playing), 'record off, loop keeps playing');

console.log('Grooves, mute, undo');
await click('[data-tool="grooves"]');
await click('[data-groove="boombap"]');
await wait(300);
const grooveCount = await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length);
check(grooveCount === 30, `groove fills the 2-bar loop (${grooveCount} hits)`);
await shot('2-grooves');
await page.evaluate(() => document.getElementById('scrim').click());
await click(`[data-mute="${drumTrack}"]`);
check(await state(() => { const p = window.bubbloop.project; return !!p.sections[p.cur].mute[p.tracks[0].id]; }), 'drums muted from the pod, in this section only');
await click(`[data-mute="${drumTrack}"]`);
await click('#btn-undo');
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length) === 2, 'undo brings back the hand-played drums');
await click('[data-tool="redo"]');
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length) === 30, 'redo restores the groove');

console.log('Your own grooves');
await click('[data-tool="grooves"]');
await page.fill('#g-name', 'Test beat');
await click('#g-save');
check(await state(() => JSON.parse(localStorage.getItem('bubbloop.grooves'))[0].name === 'Test beat'), 'a loop can be kept as a groove');
await click('[data-tool="clear"]');
await click('[data-tool="grooves"]');
await click('[data-mine]');
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].length) === 30, 'and dropped back into a loop');
await page.evaluate(() => document.getElementById('scrim').click());

console.log('Steps and chords');
await click('[data-tool="steps"]');
await tap(1, 0);
await click('#steps .step[data-step="3"]');
check(await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId].some((e) => e.t === 72 && e.r === 1 && e.c === 0)), 'step editor adds a hit');
await shot('3-steps');
await click('[data-tool="steps"]');
await click('.pod[data-track]:nth-child(3)');
check(/C/.test(await page.locator('#grid .cell[data-r="0"][data-c="0"] .lbl').innerText()), 'pads show chord names');
await click('#btn-rec');
await wait(120);
await tap(1, 0, 300); await wait(200); await tap(1, 3, 300);
await click('#btn-rec');
const chordEv = await state(() => window.bubbloop.project.sections[0].ev[window.bubbloop.trackId]);
check(chordEv.length === 2 && chordEv.every((e) => e.ch === 'triad'), 'chord bubbles recorded as chords');
await shot('4-pads');

console.log('FX');
await click('.tab[data-view="fx"]');
await click('#btn-rec');
await wait(100);
const fxBox = await page.locator('.fx[data-fx="stutter"]').boundingBox();
await page.evaluate(([x, y]) => new Promise((done) => {
  const el = document.elementFromPoint(x, y);
  const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  fire('pointerdown'); setTimeout(() => { fire('pointerup'); done(); }, 400);
}), [fxBox.x + fxBox.width / 2, fxBox.y + fxBox.height / 2]);
await click('#btn-rec');
const fxLane = await state(() => window.bubbloop.project.sections[0].fx.map((e) => ({ ...e })));
check(fxLane.length === 1 && fxLane[0].k === 'stutter' && fxLane[0].p === 1, 'held FX recorded into the loop with its setting');
await shot('5-fx');

console.log('Menus do not leak into each other');
{
  const before = await state(() => window.bubbloop.project.tracks.map((t) => t.inst).join());
  await click('.tab[data-view="play"]');
  await click('.pod[data-track]:nth-child(4)');
  await click('[data-tool="inst"]');
  await click('[data-inst="kalimba"]');
  await page.evaluate(() => document.getElementById('scrim').click());
  await click('.pod[data-track]:nth-child(2)');
  await click('[data-tool="inst"]');
  await click('[data-inst="bassSynth"]');
  await page.evaluate(() => document.getElementById('scrim').click());
  const insts = await state(() => window.bubbloop.project.tracks.map((t) => t.inst));
  check(insts[3] === 'kalimba' && insts[1] === 'bassSynth' && insts[2] === before.split(',')[2], `changing one track's sound leaves the others alone (${insts.join()})`);
  await click('.pod.add');
  await click('[data-role="melody"]');
  const after = await state(() => window.bubbloop.project.tracks.map((t) => t.inst));
  check(after.length === 5 && after.slice(0, 4).join() === insts.join(), `adding a track adds exactly one and changes no other (${after.join()})`);
  const newId = await state(() => window.bubbloop.project.tracks[4].id);
  await state(() => window.bubbloop.project.tracks[4]).then(() => {});
  await page.evaluate((id) => window.bubbloop && document.querySelector(`.pod[data-track="${id}"]`).click(), newId);
  await click('.tab[data-view="mix"]');
  await click(`[data-mixmore="${newId}"]`);
  await click('[data-act="del"]'); await click('[data-act="del"]');
  const left = await state(() => window.bubbloop.project.tracks.map((t) => t.inst));
  check(left.join() === insts.join(), `removing it leaves the original four (${left.join()})`);
  await click('#btn-key');
  await click('[data-scale="minor"]'); await click('[data-key="9"]'); await click('[data-scale="hira"]');
  check(await state(() => window.bubbloop.project.scale === 'hira' && window.bubbloop.project.key === 9), 'key and scale changes stick');
  await click('[data-key="0"]'); await click('[data-scale="major"]');
  await page.evaluate(() => document.getElementById('scrim').click());
  // FX on one track only
  await click('.tab[data-view="fx"]');
  await click('[data-tool="fxtarget"]');
  check(/only/.test(await page.locator('[data-tool="fxtarget"]').innerText()), 'FX can be aimed at the current track');
  await click('[data-tool="fxtarget"]');
  await click('.tab[data-view="play"]');
  await click('.pod[data-track]:nth-child(3)');
}

console.log('Sections and song mode');
await click('.tab[data-view="play"]');
await click('[data-sec="add"]');
await click('[data-new="copy"]');
await wait(200);
check(await state(() => window.bubbloop.project.sections.length) === 2, 'section B created from A');
await click('#btn-play');
check(!(await state(() => window.bubbloop.engine.playing)), 'stop');
await click('.tab[data-view="song"]');
await click('[data-song="build"]');
check(await state(() => window.bubbloop.project.song.length) === 2, 'song built from the sections');
const melodyId = await state(() => window.bubbloop.project.tracks[3].id);
await click(`[data-cell="0:${melodyId}"]`);
check(await state(() => !!window.bubbloop.project.song[0].off[window.bubbloop.project.tracks[3].id]), 'tapping a song bubble rests that track in the block');
// building the song leaves its first block selected, so the block tools are showing
await click('[data-tool="blk-rep"]');
check(await state(() => window.bubbloop.project.song[0].rep) === 4, 'block repeat cycles');
await click('[data-tool="blk-rep"]'); await click('[data-tool="blk-rep"]'); await click('[data-tool="blk-rep"]');
await shot('6-song');
await click('#btn-play');
await wait(500);
check(await state(() => window.bubbloop.engine.playing && window.bubbloop.engine.mode === 'song'), 'song mode plays');
await wait(1500);
await shot('7-song-playing');
// FX automation over the song: record while it plays, from the FX tab
await click('.tab[data-view="fx"]');
await click('#btn-rec');
await wait(150);
{
  const b = await page.locator('.fx[data-fx="filter"]').boundingBox();
  await page.evaluate(([x, y]) => new Promise((done) => {
    const el = document.elementFromPoint(x, y);
    const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 78, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    fire('pointerdown'); setTimeout(() => { fire('pointerup'); done(); }, 350);
  }), [b.x + b.width / 2, b.y + b.height / 2]);
}
check(await state(() => window.bubbloop.engine.mode === 'song' && window.bubbloop.project.song.some((b) => b.fx.some((f) => f.k === 'filter'))), 'FX recorded onto the song timeline from the FX tab');
await click('#btn-play');
await click('.tab[data-view="song"]');
// a long song: the view has to follow the block that is playing
await state(() => { const b = window.bubbloop; for (let i = 0; i < 12; i++) b.project.song.push({ sec: 0, rep: 1, off: {}, fx: [] }); b.engine.songFrom = 11; b.songSel = 11; });
await click('.tab[data-view="mix"]'); await click('.tab[data-view="song"]');
await click('#btn-play');
await page.waitForFunction(() => window.bubbloop.nowBlock >= 11, null, { timeout: 8000 });
await wait(700);
check(await state(() => { const m = document.querySelector('#songview .matrix').getBoundingClientRect(); const c = document.querySelector('#songview thead [data-col="' + window.bubbloop.nowBlock + '"]').getBoundingClientRect(); return c.left >= m.left && c.right <= m.right + 1; }), 'song view scrolls to follow the playing block');
check(await state(() => { const m = document.getElementById('sections').getBoundingClientRect(); const c = document.querySelector('#sections [data-block="' + window.bubbloop.nowBlock + '"]').getBoundingClientRect(); return c.left >= m.left - 1 && c.right <= m.right + 1; }), 'top strip follows it too');
await click('#btn-play');
await state(() => { const b = window.bubbloop; b.project.song.length = 2; b.engine.songFrom = 0; b.songSel = 0; });
await click('.tab[data-view="mix"]'); await click('.tab[data-view="song"]');

fs.writeFileSync(path.join(OUT, 'app-project.json'), await state(() => JSON.stringify(window.bubbloop.project, (k, v) => (k[0] === '_' ? undefined : v))));

console.log('Export');
async function exportAs(format, extra = async () => {}) {
  await click('#btn-export');
  await click(`[data-format="${format}"]`);
  await extra();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), click('#x-go')]);
  const file = path.join(OUT, 'export-' + download.suggestedFilename().replace(/[^\w.-]+/g, '_'));
  await download.saveAs(file);
  await page.waitForSelector('#x-done', { timeout: 120000 });
  await click('#x-done');
  return file;
}
const probe = (file, entry) => String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', entry, '-of', 'default=nw=1:nk=1', file])).trim();
const songSeconds = await state(() => { const p = window.bubbloop.project; return p.song.reduce((n, b) => n + p.sections[b.sec].bars * b.rep, 0) * 240 / p.bpm; });

const wav = await exportAs('wav');
await shot('8-export-done');
const wavDur = parseFloat(probe(wav, 'format=duration'));
check(probe(wav, 'stream=codec_name') === 'pcm_s16le', 'WAV is 16-bit PCM');
check(wavDur >= songSeconds && wavDur < songSeconds + 4.5, `WAV length covers the song plus tail (${wavDur.toFixed(2)}s for a ${songSeconds.toFixed(2)}s song)`);
const loud = measureLufs(wav);
check(Math.abs(loud.lufs - -8) < 1.5, `Pop master is radio loud: about -8 LUFS (ffmpeg says ${loud.lufs}, true peak ${loud.truePeak} dBTP)`);
check(loud.truePeak <= -0.9, 'true peak held under -1 dBTP');

const m4a = await exportAs('m4a');
check(probe(m4a, 'stream=codec_name') === 'alac', 'Apple Lossless file is ALAC');
// Each export renders the song afresh, and the browser's offline renderer is
// not bit-repeatable from one run to the next (stray differences sit around
// -60 dB), so compare the two files as audio rather than byte for byte.
// That the encoder itself is lossless is proven bit-for-bit in codec.test.mjs.
const pcm = (f) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', f, '-f', 's16le', '-ac', '2', '-'], { maxBuffer: 1 << 29 });
{
  const a = pcm(wav), b = pcm(m4a);
  let worst = 0, sum = 0, n = 0;
  for (let i = 0; i + 1 < Math.min(a.length, b.length); i += 2, n++) {
    const d = Math.abs(a.readInt16LE(i) - b.readInt16LE(i));
    worst = Math.max(worst, d);
    sum += d * d;
  }
  const rmsDiff = Math.sqrt(sum / Math.max(1, n));
  check(a.length === b.length && rmsDiff < 3 && worst < 400,
    `Apple Lossless export matches the WAV export (difference ${rmsDiff.toFixed(2)} rms, ${worst} worst, of 32768)`);
}
console.log(`         sizes: wav ${(fs.statSync(wav).size / 1024).toFixed(0)} KB, m4a ${(fs.statSync(m4a).size / 1024).toFixed(0)} KB`);

const mp3 = await exportAs('mp3');
check(probe(mp3, 'stream=codec_name') === 'mp3', 'MP3 file is MP3');
check(Math.abs(parseFloat(probe(mp3, 'format=duration')) - wavDur) < 0.2, 'MP3 has the same length');

const mid = await exportAs('midi');
check(fs.readFileSync(mid).subarray(0, 4).toString() === 'MThd', 'MIDI file written');

const loop = await exportAs('wav', async () => { await click('[data-what="loop"]'); await click('[data-opt="seamless"]'); });
const loopDur = parseFloat(probe(loop, 'format=duration'));
const bars = await state(() => { const p = window.bubbloop.project; return p.sections[p.cur].bars * 240 / p.bpm; });
check(Math.abs(loopDur - bars) < 0.002, `seamless loop is exactly ${bars.toFixed(3)}s (${loopDur.toFixed(3)}s)`);

await click('#btn-project');
check(await page.locator('[data-act="tour"]').count() === 1, 'the song menu keeps a "How it works" button to rewatch it');
await page.evaluate(() => document.getElementById('scrim').click());
check(fs.existsSync(new URL('../web/media/tutorial.mp4', import.meta.url)), 'the tutorial video is in the app');

console.log('Persistence');
await state(() => window.bubbloopPause());       // leaving the app saves at once
await wait(300);
const saved = await state(() => JSON.parse(localStorage.getItem('bubbloop.p.' + window.bubbloop.project.id)));
check(saved && saved.song.length === 2 && saved.sections.length === 2, 'song autosaved');
check(!JSON.stringify(saved).includes('"_p"'), 'no scratch fields in the save');
await page.reload();
check(!(await page.locator('#btn-tour').isVisible()), 'after watching once, the start screen no longer pushes it');
await click('#btn-start');
await page.waitForFunction(() => window.bubbloop && window.bubbloop.engine.ready);
check(await state(() => window.bubbloop.project.sections.length) === 2, 'song comes back after a restart');

console.log('Installable web app');
await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
await wait(1500);
await context.setOffline(true);
await page.reload();
await click('#btn-start');
check(await page.locator('#grid .cell').count() === 25, 'opens with no connection once visited');
await context.setOffline(false);
check(execFileSync('node', [new URL('../tools/make-web.mjs', import.meta.url).pathname, '--check']).toString().includes('up to date'), 'offline file list is current');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall app checks passed');
process.exit(failed ? 1 : 0);
