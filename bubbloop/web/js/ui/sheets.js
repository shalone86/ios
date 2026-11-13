// Bottom sheets: every picker and menu slides up from the bottom so the
// bubbles stay within reach of both thumbs.

import { KEY_NAMES, SCALES, CHORDS, STEP } from '../theory.js';
import { INSTRUMENTS, instrumentById } from '../instruments.js';
import { MASTERS, REVERBS, ECHOES } from '../graph.js';
import { PATTERNS } from '../patterns.js';
import * as S from '../state.js';
import { addSample, getSample, setRoot, prepareNatural, recordMic, decodeFile, sampleIds, packSamples, unpackSamples, ensureSamples } from '../samples.js';
import { midiName } from '../theory.js';
import { FILLS } from '../seq.js';
import { exportProject, FORMATS } from '../exporter.js';
import { canShare, shareFile, saveFile, isNative } from '../platform.js';
import { mountIcons, icon, mascot, GLYPHS, DONE_ART } from './art.js';
import { app, curTrack, renderAll, afterEdit, afterStructureChange, selectTrack, toast, touch, trackMascot, openProject } from './app.js';

const sheet = document.getElementById('sheet');
const body = document.getElementById('sheet-body');
const scrim = document.getElementById('scrim');
let busy = false;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

let shownTitle = null;

function show(html, bind) {
  // Every sheet gets a brand-new root element. Handlers are attached to it,
  // so they are thrown away with it; attaching them to the shared container
  // let a menu opened earlier keep reacting to taps in a later one.
  const root = document.createElement('div');
  root.innerHTML = html;
  const title = (root.querySelector('h2') || {}).textContent || '';
  const same = !sheet.hidden && title === shownTitle;
  const keep = same ? sheet.scrollTop : 0;
  // sideways strips inside the sheet keep their place too
  const strips = same ? [...body.querySelectorAll('.scroll-x')].map((n) => n.scrollLeft) : [];
  body.textContent = '';
  body.appendChild(root);
  shownTitle = title;
  sheet.hidden = false;
  scrim.hidden = false;
  sheet.style.transform = '';
  if (!same) {
    sheet.style.animation = 'none';
    void sheet.offsetWidth;
    sheet.style.animation = '';
  }
  sheet.scrollTop = keep;            // redrawing a sheet keeps your place in it
  root.querySelectorAll('.scroll-x').forEach((n, i) => { if (strips[i]) n.scrollLeft = strips[i]; });
  mountIcons(root);
  if (bind) bind(root);
}

// Pull a sheet down to dismiss it.
{
  let startY = null, pulling = false, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    const tag = e.target.tagName;
    startY = (sheet.scrollTop <= 0 && tag !== 'INPUT' && !busy) ? e.touches[0].clientY : null;
    pulling = false; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (!pulling && dy > 10) pulling = true;
    if (!pulling) { if (dy < -6) startY = null; return; }
    e.preventDefault();
    sheet.style.animation = 'none';
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => {
    if (pulling && dy > 90) closeSheet();
    else if (pulling) { sheet.style.transition = 'transform .18s'; sheet.style.transform = ''; setTimeout(() => { sheet.style.transition = ''; }, 200); }
    startY = null; pulling = false;
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

export function closeSheet() {
  if (busy) return;
  sheet.hidden = true;
  scrim.hidden = true;
  sheet.style.transform = '';
  shownTitle = null;
  body.textContent = '';
}
export const sheetIsOpen = () => !sheet.hidden;
scrim.addEventListener('click', closeSheet);

const on = (root, selector, handler) => root.addEventListener('click', (e) => {
  const node = e.target.closest(selector);
  if (node && root.contains(node)) handler(node, e);
});

function rangeFill(input) {
  const min = +input.min || 0, max = +input.max || 100;
  input.style.setProperty('--fill', `${((+input.value - min) / (max - min)) * 100}%`);
}

// Play a quick run up the scale so a new sound or key can be heard at once.
function preview(track, chordy = false) {
  const e = app.engine;
  if (!e.ready || !track) return;
  const now = e.now + 0.03;
  if (track.role === 'drums') {
    [0, 5, 2, 5].forEach((pad, i) => e.g.playDrum(track, pad, 0.9, now + i * 0.14));
    return;
  }
  if (chordy && track.chord !== 'off') {
    e.g.playCell(track, 1, 0, track.chord, 0.75, now, 0.7);
    return;
  }
  for (let i = 0; i < 6; i++) e.g.playCell(track, 1 + Math.floor(i / 5), i % 5, 'off', 0.75, now + i * 0.11, 0.22);
}

// ---------- song menu ----------

function project() {
  const p = app.project, st = app.settings;
  const others = S.listProjects().filter((x) => x.id !== p.id);
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  show(`
    <h2>Your song</h2>
    <input type="text" id="p-name" maxlength="40" value="${esc(p.name)}" aria-label="Song name">
    <div class="wrap" style="margin-top:10px">
      <button class="pill" data-act="new">${icon('plus')}New song</button>
      <button class="pill" data-act="dup">${icon('copy')}Duplicate</button>
      <button class="pill" data-act="demo">${icon('note')}Demo song</button>
      <button class="pill" data-act="export">${icon('share')}Export</button>
      <button class="pill" data-act="file">Save song file</button>
      <button class="pill" data-act="open">Import song file</button>
      ${app.midi && app.midi.supported ? `<button class="pill" data-act="midi">${icon('midi')}MIDI</button>` : ''}
      ${isNative ? '' : `<a class="pill" href="BobaBeats.apk" download="BobaBeats.apk" data-apk>${icon('share')}Android app</a>`}
    </div>
    <input type="file" id="p-file" accept=".json,.bobabeats,.bubbloop,application/json" hidden>
    ${others.length ? `<h3>Saved songs</h3><div class="list">${others.map((o) => `
      <div class="item"><button class="sp" data-open="${o.id}" style="text-align:left"><b>${esc(o.name)}</b><small>${Math.round(o.bpm)} bpm · ${ago(o.modified)}</small></button>
      <button class="pill round small danger" data-del="${o.id}" aria-label="Delete ${esc(o.name)}">${icon('trash')}</button></div>`).join('')}</div>` : ''}
    <h3>Settings</h3>
    <div class="field"><span>Buzz on tap</span><span style="flex:1"></span><button class="toggle ${st.haptics ? 'on' : ''}" data-set="haptics" aria-label="Haptics"></button></div>
    <div class="field"><span>Show note names</span><span style="flex:1"></span><button class="toggle ${st.names ? 'on' : ''}" data-set="names" aria-label="Note names"></button></div>
    <div class="field"><span>Advanced mode</span><span style="flex:1"></span><button class="toggle ${st.advanced ? 'on' : ''}" data-set="advanced" aria-label="Advanced mode"></button></div>
    <p class="sub">Adds a chord type per bubble in the Chords menu.</p>
    <div class="field"><span>Smooth audio</span><span style="flex:1"></span><button class="toggle ${st.smooth === 'on' ? 'on' : ''}" data-smooth="1" aria-label="Smooth audio"></button></div>
    <p class="sub">Only for crackle on Bluetooth: a bigger audio buffer, steadier but slower to respond to taps.</p>
    <div class="field"><span>Keep old versions</span><span style="flex:1"></span><button class="toggle ${st.versions ? 'on' : ''}" data-set="versions" aria-label="Keep old versions"></button></div>
    <p class="sub">Off: saving or exporting under the same name replaces the file. On: each save gets a new number.</p>
    <div class="field"><span>Click while playing</span><span style="flex:1"></span><button class="toggle ${st.metroPlay ? 'on' : ''}" data-set="metroPlay" aria-label="Metronome during playback"></button></div>
    <div class="field"><span>Tap timing</span><input type="range" id="p-offset" min="-80" max="160" step="5" value="${st.tapOffset}"><output id="p-offset-out">${st.tapOffset} ms</output></div>
    <p class="sub">If recorded notes land late, nudge tap timing up; if early, down.</p>
    <p class="sub center" style="margin-top:14px">Boba Beats · songs stay on this device</p>
  `, (root) => {
    const name = root.querySelector('#p-name');
    name.addEventListener('input', () => { p.name = name.value.trim() || 'Untitled'; document.getElementById('project-name').textContent = p.name; touch(); });
    const off = root.querySelector('#p-offset');
    rangeFill(off);
    off.addEventListener('input', () => {
      st.tapOffset = +off.value; rangeFill(off);
      root.querySelector('#p-offset-out').textContent = `${st.tapOffset} ms`;
      app.engine.tapOffset = st.tapOffset / 1000;
      S.saveSettings(st);
    });
    on(root, '[data-set]', (b) => {
      const k = b.dataset.set;
      st[k] = !st[k];
      b.classList.toggle('on', st[k]);
      S.saveSettings(st);
      app.engine.metroPlay = !!st.metroPlay;
      if (k === 'names') renderAll();
    });
    on(root, '[data-smooth]', (b) => {
      st.smooth = st.smooth === 'on' ? 'off' : 'on';
      S.saveSettings(st);
      b.classList.toggle('on', st.smooth === 'on');
      app.engine.smooth = st.smooth;
      app.engine.reopen();
    });
    on(root, '[data-open]', async (b) => {
      const loaded = S.loadProject(b.dataset.open);
      if (!loaded) { toast('That song could not be opened'); return; }
      closeSheet();
      await openProject(loaded);
      toast(`Opened ${loaded.name}`);
    });
    on(root, '[data-del]', (b) => {
      if (b.dataset.sure) { S.deleteProject(b.dataset.del); project(); }
      else { b.dataset.sure = '1'; b.classList.add('on'); toast('Tap again to delete it for good'); }
    });
    const file = root.querySelector('#p-file');
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        if (raw.samples) { await unpackSamples(raw.samples); delete raw.samples; }
        const loaded = S.repair(raw);
        if (!loaded) throw new Error('not a song');
        loaded.id = Math.random().toString(36).slice(2, 10);
        closeSheet();
        await openProject(loaded);
        toast(`Opened ${loaded.name}`);
      } catch (e) { toast('That file is not a Boba Beats song'); }
    });
    on(root, '[data-act]', async (b) => {
      const act = b.dataset.act;
      if (act === 'new') { closeSheet(); await openProject(S.newProject()); toast('Fresh song, fresh bubbles'); }
      else if (act === 'dup') { closeSheet(); await openProject(S.duplicateProject(p)); toast('Working on a copy'); }
      else if (act === 'demo') { closeSheet(); await openProject(S.demoProject()); toast('Press play, then poke around'); }
      else if (act === 'export') exporter();
      else if (act === 'midi') midiSheet();
      else if (act === 'open') file.click();
      else if (act === 'file') {
        try {
          const saved = await saveFile(`${p.name.replace(/[\\/:*?"<>|]/g, ' ')}.bobabeats.json`, 'application/json', new TextEncoder().encode(JSON.stringify({ ...JSON.parse(S.serialize(p)), samples: await packSamples(sampleIds(p)) })));
          toast(`Saved to ${saved.where}`);
        } catch (e) { toast(e.message); }
      }
    });
  });
}

// ---------- tempo ----------

function tempo() {
  const p = app.project;
  const QUANTS = [[0, 'Off'], [STEP * 2, '1/8'], [STEP, '1/16'], [STEP * 2 / 3, '1/16T'], [STEP / 2, '1/32']];
  show(`
    <h2>Tempo & feel</h2>
    <div class="bignum"><span id="t-bpm">${Math.round(p.bpm)}</span> <small>bpm</small></div>
    <div class="field"><button class="pill round" data-bpm="-1">−</button><input type="range" id="t-slider" min="50" max="200" value="${Math.round(p.bpm)}"><button class="pill round" data-bpm="1">+</button></div>
    <button class="pill primary" id="t-tap">Tap the beat</button>
    <h3>Swing</h3>
    <div class="field"><input type="range" id="t-swing" min="0" max="100" value="${Math.round(p.swing * 100)}"><output id="t-swing-out">${Math.round(p.swing * 100)}%</output></div>
    <h3>Snap notes while recording</h3>
    <div class="wrap">${QUANTS.map(([v, n]) => `<button class="pill ${Math.abs(p.quant - v) < 0.01 ? 'on' : ''}" data-q="${v}">${n}</button>`).join('')}</div>
    <div class="field" style="margin-top:14px"><span>Metronome</span><span style="flex:1"></span><button class="toggle ${p.metro ? 'on' : ''}" id="t-metro" aria-label="Metronome"></button></div>
  `, (root) => {
    const slider = root.querySelector('#t-slider'), out = root.querySelector('#t-bpm');
    const set = (bpm) => {
      bpm = Math.max(50, Math.min(200, Math.round(bpm)));
      app.engine.setBpm(bpm);
      slider.value = bpm; rangeFill(slider);
      out.textContent = bpm;
      document.getElementById('tempo-label').textContent = bpm;
      touch();
    };
    rangeFill(slider);
    slider.addEventListener('input', () => set(+slider.value));
    on(root, '[data-bpm]', (b) => set(p.bpm + +b.dataset.bpm));
    let taps = [];
    root.querySelector('#t-tap').addEventListener('pointerdown', () => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 2500);
      taps.push(now);
      if (taps.length >= 3) {
        const gaps = taps.slice(1).map((t, i) => t - taps[i]);
        set(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      }
    });
    const swing = root.querySelector('#t-swing');
    rangeFill(swing);
    swing.addEventListener('input', () => {
      p.swing = +swing.value / 100; rangeFill(swing);
      root.querySelector('#t-swing-out').textContent = `${swing.value}%`;
      touch();
    });
    on(root, '[data-q]', (b) => {
      p.quant = +b.dataset.q;
      root.querySelectorAll('[data-q]').forEach((n) => n.classList.toggle('on', n === b));
      touch();
    });
    root.querySelector('#t-metro').addEventListener('click', (e) => { p.metro = !p.metro; e.currentTarget.classList.toggle('on', p.metro); touch(); });
  });
}

// ---------- key & scale ----------

function key() {
  const p = app.project;
  const draw = () => show(`
    <h2>Key & scale</h2>
    <p class="sub">Every bubble follows this, on every track. Change it any time and the whole song moves with it.</p>
    <div class="keys">${KEY_NAMES.map((n, i) => `<button class="${i === p.key ? 'on' : ''}" data-key="${i}">${n}</button>`).join('')}</div>
    <h3>Five-note scale</h3>
    <div class="cards">${SCALES.map((s) => `<button class="card ${s.id === p.scale ? 'on' : ''}" data-scale="${s.id}"><b>${s.name}</b><small>${s.mood}</small></button>`).join('')}</div>
  `, (root) => {
    const voice = () => p.tracks.find((t) => t.id === app.trackId && t.role !== 'drums') || p.tracks.find((t) => t.role === 'melody') || p.tracks.find((t) => t.role !== 'drums');
    on(root, '[data-key]', async (b) => {
      p.key = +b.dataset.key;
      await app.engine.setKey();
      renderAll(); touch(); draw(); preview(voice());
    });
    on(root, '[data-scale]', (b) => {
      p.scale = b.dataset.scale;
      renderAll(); touch(); draw(); preview(voice());
    });
  });
  draw();
}

// ---------- instruments ----------

function instrument(track) {
  if (!track) return;
  if (track.role === 'drums') { grooves(); return; }
  const list = INSTRUMENTS.filter((i) => i.id !== 'drums');
  const suited = list.filter((i) => i.roles.includes(track.role)), rest = list.filter((i) => !i.roles.includes(track.role));
  const card = (i) => `<button class="card ${i.id === track.inst ? 'on' : ''}" data-inst="${i.id}">${GLYPHS[i.face] || ''}<b>${i.name}</b></button>`;
  show(`
    <h2>${esc(track.name)}: pick a voice</h2>
    <p class="sub">Your notes stay put. Only the sound changes, so try them all.</p>
    <div class="cards">${suited.map(card).join('')}</div>
    <h3>More sounds</h3>
    <div class="cards">${rest.map(card).join('')}</div>
  `, (root) => {
    on(root, '[data-inst]', (b) => {
      track.inst = b.dataset.inst;
      app.engine.syncTrack(track);
      if (track.inst === 'sampler') { renderAll(); touch(); sampler(track); return; }
      root.querySelectorAll('[data-inst]').forEach((n) => n.classList.toggle('on', n === b));
      preview(track, true);
      renderAll(); touch();
    });
  });
}

function chord() {
  const t = curTrack(), p = app.project;
  const adv = app.settings.advanced;
  const own = t.chords || {};
  const sc = SCALES.find((x) => x.id === p.scale) || SCALES[0];
  show(`
    <h2>Chords</h2>
    <p class="sub">One bubble, a whole chord. They are built from the song's key, so they always fit.</p>
    <div class="list">${CHORDS.map((c) => `<button class="item ${c.id === t.chord ? 'on' : ''}" data-chord="${c.id}"><span class="sp"><b>${c.name}</b><small>${c.hint}</small></span>${c.id === t.chord ? icon('check') : ''}</button>`).join('')}</div>
    ${adv ? `<h3>Per bubble (advanced)</h3>
    <p class="sub">Give a column its own chord type. "Track" means it follows the choice above.</p>
    ${[0, 1, 2, 3, 4].map((c) => `<div class="field" style="align-items:flex-start"><span style="min-width:34px;padding-top:8px">${KEY_NAMES[(p.key + sc.steps[c]) % 12]}</span><div class="scroll-x" style="flex:1;padding:2px 0">
      <button class="pill small ${own[c] ? '' : 'on'}" data-own="${c}:">Track</button>${CHORDS.map((k) => `<button class="pill small ${own[c] === k.id ? 'on' : ''}" data-own="${c}:${k.id}">${k.name}</button>`).join('')}</div></div>`).join('')}` : '<p class="sub" style="margin-top:10px">Want a different chord type on each bubble? Turn on Advanced mode in the song menu settings.</p>'}
  `, (root) => {
    on(root, '[data-chord]', (b) => {
      t.chord = b.dataset.chord;
      if (!adv) closeSheet(); else chord();
      renderAll(); touch(); preview(t, true);
    });
    on(root, '[data-own]', (b) => {
      const [c, id] = b.dataset.own.split(':');
      t.chords = t.chords || {};
      if (id) t.chords[c] = id; else delete t.chords[c];
      renderAll(); touch(); chord();
      const e = app.engine;
      if (e.ready) e.g.playCell(t, 1, +c, S.chordOf(t, +c), 0.75, e.now + 0.03, 0.6);
    });
  });
}

// The sampler: record or import a sound, then play it on the bubbles.
let recorder = null;
function sampler(t) {
  const p = app.project, e = app.engine;
  t.smp = t.smp || { mode: 'keys', key: null, kit: {} };
  const kit = t.smp.mode === 'kit';
  const slot = app.focus.r * 5 + app.focus.c;
  const cur = getSample(kit ? t.smp.kit[slot] : t.smp.key);
  const put = async (sound, name) => {
    const made = await addSample(sound.data, sound.sr, name);
    if (!made) { toast('That was silent: try again, a little louder'); return; }
    if (kit) t.smp.kit[slot] = made.id; else t.smp.key = made.id;
    touch(); renderAll(); sampler(t);
    if (!kit) prepareNatural(p);
    if (e.ready) e.g.playSample(t, kit ? app.focus.r : 1, kit ? app.focus.c : 0, 'off', 0.9, e.now + 0.05, 1.2);
  };
  show(`
    <h2>Sampler</h2>
    <div class="wrap">
      <button class="pill ${kit ? '' : 'on'}" data-mode="keys">Keyboard: one sound, every note</button>
      <button class="pill ${kit ? 'on' : ''}" data-mode="kit">Kit: a sound per bubble</button>
    </div>
    <p class="sub" style="margin-top:10px">${kit
      ? `Filling bubble <b>row ${app.focus.r + 1}, column ${app.focus.c + 1}</b>. Close this, tap another bubble, and come back to fill that one.`
      : 'Your sound is tuned automatically and spread across the bubbles in the song\'s key.'}</p>
    <div class="item" style="margin:6px 0 12px"><span class="sp"><b>${cur ? esc(cur.name) : 'Nothing here yet'}</b>
      <small>${cur ? `${cur.buffer.duration.toFixed(1)} s${kit ? '' : ` · heard as ${midiName(Math.round(cur.root))}${cur.pitched ? '' : ' (no clear pitch found)'}`}` : 'Record something or bring in a file'}</small></span>
      ${cur && !kit ? '<span class="stepper"><button data-root="-1">−</button><span>tune</span><button data-root="1">+</button></span>' : ''}</div>
    ${kit ? '' : `<h3>Pitch</h3>
    <div class="wrap">
      <button class="pill small ${t.smp.shift === 'classic' ? '' : 'on'}" data-shift="natural">Natural: keeps the voice</button>
      <button class="pill small ${t.smp.shift === 'classic' ? 'on' : ''}" data-shift="classic">Classic: chipmunk and giant</button>
    </div>
    ${t.smp.shift === 'classic' ? '' : `<div class="field"><span>Formant</span><span class="stepper"><button data-formant="-1">−</button><span>${(t.smp.formant || 0) > 0 ? '+' : ''}${t.smp.formant || 0}</span><button data-formant="1">+</button></span><span class="sub" style="margin:0">${(t.smp.formant || 0) < 0 ? 'bigger, darker' : (t.smp.formant || 0) > 0 ? 'smaller, brighter' : 'as recorded'}</span></div>`}`}
    <button class="pill primary" id="s-rec">${recorder ? 'Stop' : 'Record with the microphone'}</button>
    <div class="progress" ${recorder ? '' : 'hidden'}><i id="s-level"></i></div>
    <div class="wrap" style="margin-top:10px">
      <button class="pill" id="s-file">Import an audio file</button>
      ${cur ? '<button class="pill" id="s-play">Hear it</button><button class="pill danger" id="s-clear">Remove</button>' : ''}
    </div>
    <input type="file" id="s-input" accept="audio/*" hidden>
    <p class="sub" style="margin-top:10px">Up to 12 seconds. Silence at the ends is trimmed for you.</p>
  `, (root) => {
    const hear = async () => {
      await prepareNatural(p);
      if (e.ready) e.g.playSample(t, 1, 2, 'off', 0.9, e.now + 0.03, 0.9);
    };
    on(root, '[data-shift]', (b) => { t.smp.shift = b.dataset.shift; touch(); sampler(t); hear(); });
    on(root, '[data-formant]', (b) => {
      t.smp.formant = Math.max(-12, Math.min(12, (t.smp.formant || 0) + +b.dataset.formant));
      touch(); sampler(t); hear();
    });
    on(root, '[data-mode]', (b) => { t.smp.mode = b.dataset.mode; touch(); renderAll(); sampler(t); });
    on(root, '[data-root]', (b) => { setRoot(cur.id, cur.root - +b.dataset.root); sampler(t); if (e.ready) e.g.playSample(t, 1, 0, 'off', 0.9, e.now + 0.03, 0.8); });
    root.querySelector('#s-rec').addEventListener('click', async () => {
      await e.wake(p);
      if (recorder) {
        const r = recorder; recorder = null;
        await put(r.stop(), kit ? `Pad ${slot + 1}` : 'My sound');
        return;
      }
      try {
        if (e.playing) e.stop();
        recorder = await recordMic(e.ctx);
      } catch (err) { toast('The microphone is not available: check the app\'s permission'); return; }
      sampler(t);
      const meter = () => {
        const bar = document.getElementById('s-level');
        if (!recorder || !bar) return;
        bar.style.width = `${Math.min(100, recorder.level() * 140)}%`;
        if (recorder.full()) { document.getElementById('s-rec').click(); return; }
        requestAnimationFrame(meter);
      };
      meter();
    });
    const input = root.querySelector('#s-input');
    root.querySelector('#s-file').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { await e.wake(p); await put(await decodeFile(e.ctx, f), f.name.replace(/\.[^.]+$/, '').slice(0, 24)); }
      catch (err) { toast('That file could not be read as audio'); }
    });
    const play = root.querySelector('#s-play');
    if (play) play.addEventListener('click', async () => { await e.wake(p); e.g.playSample(t, kit ? app.focus.r : 1, kit ? app.focus.c : 0, 'off', 0.9, e.now + 0.03, 1.5); });
    const clear = root.querySelector('#s-clear');
    if (clear) clear.addEventListener('click', () => { if (kit) delete t.smp.kit[slot]; else t.smp.key = null; touch(); renderAll(); sampler(t); });
  });
}

// Copying a song block: choose where the copy goes.
function copyBlock(i) {
  const p = app.project;
  show(`
    <h2>Copy block ${i + 1}</h2>
    <p class="sub">The copy keeps this block's fills, energy and recorded FX.</p>
    <div class="list">
      <button class="item" data-at="${i + 1}"><span class="sp"><b>Right after it</b></span></button>
      <button class="item" data-at="${p.song.length}"><span class="sp"><b>At the end of the song</b></span></button>
      <button class="item" data-at="0"><span class="sp"><b>At the start</b></span></button>
    </div>
    <p class="sub" style="margin-top:8px">Then use the arrows to nudge it into place.</p>
  `, (root) => {
    on(root, '[data-at]', (b) => {
      const at = +b.dataset.at;
      S.addBlock(p, at, i);
      app.songSel = at;
      app.engine.songFrom = at;
      closeSheet(); renderAll(); touch();
    });
  });
}

function grooves() {
  const p = app.project, st = app.settings;
  const t = curTrack().role === 'drums' ? curTrack() : p.tracks.find((x) => x.role === 'drums');
  if (!t) { toast('Add a drum track first'); return; }
  const kind = t.group || 'kit';
  const mine = S.listGrooves().filter((g) => g.kind === kind);
  const hasNotes = S.trackEvents(p, p.cur, t.id).length > 0;
  show(`
    <h2>Drum grooves</h2>
    <p class="sub">Drop a beat into this loop, then change it: tap extra hits over the top, or open Steps to edit it note by note.</p>
    <h3>Yours</h3>
    ${mine.length ? `<div class="list">${mine.map((g) => `<div class="item"><button class="sp" data-mine="${g.id}" style="text-align:left"><b>${esc(g.name)}</b><small>${g.len / 384} bar${g.len > 384 ? 's' : ''}</small></button><button class="pill round small danger" data-gdel="${g.id}" aria-label="Delete ${esc(g.name)}">${icon('trash')}</button></div>`).join('')}</div>` : '<p class="sub">None yet. Make a beat you like, then keep it here to reuse in any song.</p>'}
    <div class="field" style="margin-top:8px"><input type="text" id="g-name" maxlength="24" placeholder="Name this loop's beat" aria-label="Groove name"><button class="pill" id="g-save" ${hasNotes ? '' : 'disabled'}>Keep</button></div>
    <div class="field" style="margin-top:14px"><span>Built-in grooves</span><span style="flex:1"></span><button class="toggle ${st.builtin ? 'on' : ''}" id="g-builtin" aria-label="Show built-in grooves"></button></div>
    ${st.builtin ? `<div class="cards">${PATTERNS.map((g) => `<button class="card" data-groove="${g.id}"><b>${g.name}</b><small>${g.mood}</small></button>`).join('')}</div>` : '<p class="sub">Hidden. Only grooves you made are offered.</p>'}
  `, (root) => {
    const start = async (label) => {
      afterEdit();
      await app.engine.wake(p);
      if (!app.engine.playing) app.engine.play();
      toast(label);
    };
    on(root, '[data-groove]', (b) => {
      const g = PATTERNS.find((x) => x.id === b.dataset.groove);
      S.applyPattern(p, p.cur, t.id, g.id);
      root.querySelectorAll('[data-groove]').forEach((n) => n.classList.toggle('on', n === b));
      start(g.swing ? `${g.name} · swing ${Math.round(g.swing * 100)}%` : g.name);
    });
    on(root, '[data-mine]', (b) => {
      const g = mine.find((x) => x.id === b.dataset.mine);
      S.applyGroove(p, p.cur, t.id, g);
      start(g.name);
    });
    on(root, '[data-gdel]', (b) => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.classList.add('on'); toast('Tap again to delete it'); return; }
      S.deleteGroove(b.dataset.gdel); grooves();
    });
    root.querySelector('#g-save').addEventListener('click', () => {
      const name = root.querySelector('#g-name').value.trim() || `${p.name} ${S.SECTION_NAMES[p.cur]}`;
      if (S.saveGroove(p, p.cur, t, name)) { toast(`Kept as "${name}"`); grooves(); }
    });
    root.querySelector('#g-builtin').addEventListener('click', () => { st.builtin = !st.builtin; S.saveSettings(st); grooves(); });
  });
}

// ---------- tracks ----------

function addTrack() {
  const roles = [['drums', 'Drums', 'finger drum kit'], ['bass', 'Bass', 'the low end'], ['pads', 'Pads', 'chords and clouds'], ['melody', 'Melody', 'the tune on top']];
  show(`
    <h2>Add a track</h2>
    <p class="sub">Same bubbles, a new bandmate. You can have up to ${S.MAX_TRACKS}.</p>
    <div class="cards">${roles.map(([r, n, h]) => `<button class="card" data-role="${r}">${mascot(r, app.project.tracks.filter((t) => t.role === r).length)}<b>${n}</b><small>${h}</small></button>`).join('')}
      <button class="card" data-split="1">${mascot('drums', 3)}<b>Drums ×4</b><small>kicks, snares, hats, perc on their own tracks</small></button></div>
  `, (root) => {
    on(root, '[data-split]', () => {
      const made = S.addDrumSplit(app.project);
      if (!made) { toast('Not enough room: remove a track first'); return; }
      made.forEach((t) => app.engine.syncTrack(t));
      closeSheet();
      afterStructureChange(false);
      selectTrack(made[0].id);
      toast('Four drum tracks. Rows retune each sound.');
    });
    on(root, '[data-role]', (b) => {
      const role = b.dataset.role;
      const taken = app.project.tracks.filter((t) => t.role === role).map((t) => t.inst);
      const fresh = INSTRUMENTS.find((i) => i.roles[0] === role && !taken.includes(i.id)) || INSTRUMENTS.find((i) => i.roles.includes(role) && !taken.includes(i.id));
      const t = S.addTrack(app.project, role, fresh ? fresh.id : undefined);
      if (!t) { toast('The band is full'); return; }
      app.engine.syncTrack(t);
      closeSheet();
      afterStructureChange(false);
      selectTrack(t.id);
      preview(t, true);
    });
  });
}

function track(t) {
  if (!t) return;
  const p = app.project;
  show(`
    <h2>${trackMascot(t).replace('class="mascot ', 'style="width:34px;height:34px;vertical-align:middle;margin-right:6px" class="mascot ')}${esc(t.name)}</h2>
    <input type="text" id="k-name" maxlength="18" value="${esc(t.name)}" aria-label="Track name">
    <div class="wrap" style="margin-top:10px">
      ${t.role === 'drums' ? '<button class="pill" data-act="grooves">Grooves</button>' : `<button class="pill" data-act="inst">${esc(instrumentById(t.inst).name)} ▾</button>`}
      <button class="pill" data-act="left">${icon('left')}Move</button>
      <button class="pill" data-act="right">Move${icon('right')}</button>
      <button class="pill" data-act="snap">Snap to grid</button>
      ${t.role === 'drums' ? '' : `<button class="pill ${t.duck ? 'on' : ''}" data-act="duck">Duck under kick${t.duck ? ': ' + (t.duck >= 1 ? 'hard' : 'soft') : ''}</button>`}
      <button class="pill" data-act="clear">Clear this loop</button>
      <button class="pill danger" data-act="del">${icon('trash')}Remove track</button>
    </div>
  `, (root) => {
    const name = root.querySelector('#k-name');
    name.addEventListener('input', () => { t.name = name.value.trim() || 'Track'; renderAll(); touch(); });
    on(root, '[data-act]', (b) => {
      const act = b.dataset.act;
      if (act === 'inst') instrument(t);
      else if (act === 'duck') { t.duck = !t.duck ? 0.6 : t.duck < 1 ? 1 : 0; touch(); track(t); toast(t.duck ? 'Dips every time a kick lands' : 'Ducking off'); }
      else if (act === 'grooves') { selectTrack(t.id); grooves(); }
      else if (act === 'left' || act === 'right') { if (S.moveTrack(p, t.id, act === 'left' ? -1 : 1)) { renderAll(); touch(); } }
      else if (act === 'snap') { S.quantizeTrack(p, p.cur, t.id, p.quant || STEP); afterEdit(); closeSheet(); toast('Snapped to the grid'); }
      else if (act === 'clear') { S.clearTrack(p, p.cur, t.id); afterEdit(); closeSheet(); toast(`${t.name} cleared`); }
      else if (act === 'del') {
        if (p.tracks.length <= 1) { toast('A song needs at least one track'); return; }
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.classList.add('on'); toast('Tap again to remove it'); return; }
        S.removeTrack(p, t.id);
        app.engine.removeTrack(t.id);
        closeSheet();
        afterStructureChange(false);
      }
    });
  });
}

// ---------- sections ----------

function addSection() {
  const p = app.project, name = S.SECTION_NAMES[p.cur], next = S.SECTION_NAMES[p.sections.length];
  show(`
    <h2>New section ${next}</h2>
    <p class="sub">Sections are different loops in the same song: a verse, a chorus, a breakdown.</p>
    <div class="list">
      <button class="item" data-new="copy"><span class="sp"><b>Start from ${name}</b><small>copy it, then change what you like</small></span></button>
      <button class="item" data-new="empty"><span class="sp"><b>Start empty</b><small>a blank loop</small></span></button>
    </div>
  `, (root) => {
    on(root, '[data-new]', (b) => {
      const idx = S.addSection(p, b.dataset.new === 'copy' ? p.cur : null);
      if (idx < 0) { toast('That is all eight sections'); return; }
      closeSheet();
      app.engine.setSection(idx);
      if (!app.engine.playing) afterStructureChange(false); else renderAll();
      touch();
    });
  });
}

function section(idx) {
  const p = app.project, name = S.SECTION_NAMES[idx];
  show(`
    <h2>Section ${name}</h2>
    <div class="wrap">
      <button class="pill" data-act="copy">${icon('copy')}Copy to a new section</button>
      <button class="pill" data-act="clear">Clear everything in ${name}</button>
      ${p.sections.length > 1 ? `<button class="pill danger" data-act="del">${icon('trash')}Delete ${name}</button>` : ''}
    </div>
  `, (root) => {
    on(root, '[data-act]', (b) => {
      const act = b.dataset.act;
      if (act === 'copy') {
        const n = S.addSection(p, idx);
        if (n < 0) { toast('That is all eight sections'); return; }
        app.engine.setSection(n);
      } else if (act === 'clear') S.clearSection(p, idx);
      else if (act === 'del') {
        if (app.engine.playing) app.engine.stop();
        S.removeSection(p, idx);
      }
      closeSheet();
      afterStructureChange(false);
    });
  });
}

// ---------- mastering ----------

function master() {
  const p = app.project;
  show(`
    <h2>Mastering</h2>
    <p class="sub">The final polish on everything you hear, and on what you export.</p>
    <div class="list">${MASTERS.map((m) => `<button class="item ${m.id === p.master ? 'on' : ''}" data-master="${m.id}"><span class="sp"><b>${m.name}</b><small>${m.hint}${m.lufs ? ` · ${m.lufs} LUFS` : ''}</small></span>${m.id === p.master ? icon('check') : ''}</button>`).join('')}</div>
  `, (root) => {
    on(root, '[data-master]', (b) => {
      app.engine.setMaster(b.dataset.master);
      closeSheet(); renderAll(); touch();
    });
  });
}

function space() {
  const p = app.project;
  const cur = p.space || { rev: 'hall', dly: 'ping' };
  const list = (items, key) => items.map((m) => `<button class="item ${m.id === cur[key] ? 'on' : ''}" data-space="${key}:${m.id}"><span class="sp"><b>${m.name}</b><small>${m.hint}</small></span>${m.id === cur[key] ? icon('check') : ''}</button>`).join('');
  show(`
    <h2>Cloud & Echo type</h2>
    <p class="sub">The character of this song's reverb and echo: the mixer sliders and the FX pads both use them.</p>
    <h3>Cloud (reverb)</h3><div class="list">${list(REVERBS, 'rev')}</div>
    <h3>Echo (delay)</h3><div class="list">${list(ECHOES, 'dly')}</div>
  `, (root) => {
    on(root, '[data-space]', (b) => {
      const [key, id] = b.dataset.space.split(':');
      app.engine.setSpace({ ...cur, [key]: id });
      touch(); space();
    });
  });
}

// ---------- export ----------

const exportChoice = { format: 'wav', what: 'song', hires: false, seamless: false };

function masterBlurb(m) {
  const hint = m.hint[0].toUpperCase() + m.hint.slice(1);
  return esc(m.lufs ? `${hint}. Tape, tone balance, multiband dynamics, stereo width, glue and a maximizer, to ${m.lufs} LUFS with peaks under -1 dBTP.` : `${hint}. Peaks are kept safe and nothing else is changed.`);
}

function exporter() {
  const p = app.project;
  const hasSong = p.song.length > 0;
  const c = exportChoice;
  if (!hasSong) c.what = 'loop';
  const sec = S.SECTION_NAMES[p.cur];
  const draw = () => show(`
    <h2>Export</h2>
    <p class="sub">Nothing is baked in. Export, listen, tweak, export again.</p>
    <h3>What</h3>
    <div class="wrap">
      <button class="pill ${c.what === 'song' ? 'on' : ''}" data-what="song" ${hasSong ? '' : 'disabled'}>Whole song${hasSong ? ` · ${Math.floor(S.songSeconds(p) / 60)}:${String(Math.round(S.songSeconds(p)) % 60).padStart(2, '0')}` : ''}</button>
      <button class="pill ${c.what === 'loop' ? 'on' : ''}" data-what="loop">Loop ${sec}</button>
    </div>
    ${hasSong ? '' : '<p class="sub" style="margin-top:8px">To export a whole song, arrange your loops in the Song tab first.</p>'}
    <h3>Format</h3>
    <div class="cards">${FORMATS.map((f) => `<button class="card ${c.format === f.id ? 'on' : ''}" data-format="${f.id}"><b>${f.name}</b><small>${f.hint}</small></button>`).join('')}</div>
    ${c.format === 'midi' || c.format === 'pack' ? '' : `
    <h3>Mastering</h3>
    <div class="wrap">${MASTERS.map((m) => `<button class="pill ${p.master === m.id ? 'on' : ''}" data-master="${m.id}" ${c.format === 'stems' ? 'disabled' : ''}>${m.name}</button>`).join('')}</div>
    <p class="sub" style="margin-top:8px">${c.format === 'stems' ? 'Stems are left unmastered so you can mix them yourself.' : masterBlurb(MASTERS.find((m) => m.id === p.master))}</p>
    <h3>Options</h3>
    ${c.format === 'mp3' ? '' : `<div class="field"><span>24-bit</span><span style="flex:1"></span><button class="toggle ${c.hires ? 'on' : ''}" data-opt="hires" aria-label="24-bit"></button></div>`}
    ${c.what === 'loop' && c.format !== 'stems' ? `<div class="field"><span>Seamless loop</span><span style="flex:1"></span><button class="toggle ${c.seamless ? 'on' : ''}" data-opt="seamless" aria-label="Seamless loop"></button></div><p class="sub">On: the file loops perfectly in a DAW. Off: the last notes ring out.</p>` : ''}`}
    <button class="pill primary" id="x-go" style="margin-top:14px">Export ${FORMATS.find((f) => f.id === c.format).name}</button>
  `, (root) => {
    on(root, '[data-what]', (b) => { c.what = b.dataset.what; draw(); });
    on(root, '[data-format]', (b) => { c.format = b.dataset.format; draw(); });
    on(root, '[data-master]', (b) => { app.engine.setMaster(b.dataset.master); touch(); draw(); });
    on(root, '[data-opt]', (b) => { c[b.dataset.opt] = !c[b.dataset.opt]; draw(); });
    root.querySelector('#x-go').addEventListener('click', run);
  });

  const run = async () => {
    if (app.engine.playing) app.engine.stop();
    busy = true;
    show(`
      <h2>Making your ${FORMATS.find((f) => f.id === c.format).name}…</h2>
      <div class="progress"><i id="x-bar"></i></div>
      <p class="sub center" id="x-label">Warming up</p>
    `);
    const bar = body.querySelector('#x-bar'), label = body.querySelector('#x-label');
    try {
      const res = await exportProject(p, { format: c.format, what: c.what, master: p.master, bits: c.hires ? 24 : (c.format === 'stems' ? 24 : 16), seamless: c.seamless },
        (text, frac) => { label.textContent = text; bar.style.width = `${Math.round(frac * 100)}%`; });
      busy = false;
      const first = res.files[0];
      const loud = res.info && Number.isFinite(res.info.after) ? ` · ${res.info.after.toFixed(1)} LUFS` : '';
      show(`
        ${DONE_ART}
        <h2 class="center">Saved!</h2>
        <p class="sub center">${res.files.length > 1 ? `${res.files.length} files` : esc(first.name)}<br>in ${esc(first.where)}${loud}</p>
        ${canShare(first) ? `<button class="pill primary" id="x-share">${icon('share')}Share it</button>` : ''}
        <div class="wrap" style="margin-top:10px;justify-content:center"><button class="pill" id="x-again">Export something else</button><button class="pill" id="x-done">Done</button></div>
        ${isNative ? '' : '<p class="sub center" style="margin-top:10px">Your browser saved it with your downloads.</p>'}
      `, (root) => {
        const share = root.querySelector('#x-share');
        if (share) share.addEventListener('click', () => shareFile(first, p.name));
        root.querySelector('#x-again').addEventListener('click', draw);
        root.querySelector('#x-done').addEventListener('click', closeSheet);
      });
    } catch (e) {
      busy = false;
      show(`<h2>That did not work</h2><p class="sub">${esc(e.message || e)}</p><button class="pill primary" id="x-back">Back</button>`,
        (root) => root.querySelector('#x-back').addEventListener('click', draw));
    }
  };
  draw();
}

// Long-press a bubble in the song matrix: ways to vary one track in one block.
function spice(blockIdx, trackId) {
  const p = app.project, b = p.song[blockIdx], t = p.tracks.find((x) => x.id === trackId);
  if (!b || !t) return;
  const draw = () => {
    const sp = (b.sp && b.sp[trackId]) || {};
    const vel = sp.vel || 1;
    show(`
      <h2>${esc(t.name)} in block ${blockIdx + 1}</h2>
      <p class="sub">Spice up this one spot without touching the loop itself.</p>
      <h3>Fill at the end</h3>
      <div class="wrap">${[['', 'None'], ...FILLS].map(([id, n]) => `<button class="pill ${(sp.fill === true ? 'rep8' : sp.fill || '') === id ? 'on' : ''}" data-fill="${id}">${n}</button>`).join('')}</div>
      <p class="sub" style="margin-top:8px">Reworks the last two beats out of what this track already plays.</p>
      <h3>Energy</h3>
      <div class="wrap">${[[0.55, 'Whisper'], [0.78, 'Soft'], [1, 'Normal'], [1.25, 'Hard']].map(([v, n]) => `<button class="pill ${Math.abs(vel - v) < 0.01 ? 'on' : ''}" data-vel="${v}">${n}</button>`).join('')}</div>
      <div class="field" style="margin-top:14px"><span>Playing</span><span style="flex:1"></span><button class="toggle ${b.off[trackId] ? '' : 'on'}" data-sp="on" aria-label="Playing"></button></div>
    `, (root) => {
      const edit = (fn) => {
        S.pushUndo(p);
        b.sp = b.sp || {};
        const cur = b.sp[trackId] || {};
        fn(cur);
        if (!cur.fill && (!cur.vel || cur.vel === 1)) delete b.sp[trackId]; else b.sp[trackId] = cur;
        touch(); renderAll(); draw();
      };
      on(root, '[data-fill]', (n) => edit((c) => { c.fill = n.dataset.fill || undefined; }));
      on(root, '[data-vel]', (n) => edit((c) => { c.vel = +n.dataset.vel; }));
      on(root, '[data-sp="on"]', () => { S.pushUndo(p); if (b.off[trackId]) delete b.off[trackId]; else b.off[trackId] = true; touch(); renderAll(); draw(); });
    });
  };
  draw();
}

// ---------- MIDI ----------

let midiListenerBound = false;
function midiSheet() {
  const m = app.midi;
  const st = app.settings.midi;
  if (!midiListenerBound) {
    midiListenerBound = true;
    document.addEventListener('bubbloop:midi', () => {
      if (sheetIsOpen() && shownTitle === 'MIDI') midiSheet();
    });
  }
  if (!m || !m.supported) {
    show(`
      <h2>MIDI</h2>
      <p class="sub">This browser does not support Web MIDI. Open Boba Beats in Chrome, Edge, or Firefox on desktop to play with MIDI keyboards, drum pads, and external synths.</p>
      <button class="pill primary" id="m-close">Got it</button>
    `, (root) => root.querySelector('#m-close').addEventListener('click', closeSheet));
    return;
  }
  if (!m.connected) {
    show(`
      <h2>MIDI</h2>
      <p class="sub">Play Boba Beats from a USB MIDI keyboard or pad controller, or send loops out to your DAW or hardware synth.</p>
      ${m.error ? `<p class="sub" style="color:#d43d62">${esc(m.error)}</p>` : ''}
      <button class="pill primary" id="m-conn">Connect MIDI devices</button>
    `, (root) => root.querySelector('#m-conn').addEventListener('click', async () => {
      await m.connect();
      midiSheet();
    }));
    return;
  }

  const ins = m.inputs();
  const outs = m.outputs();
  const act = m.lastActivity && Date.now() - m.lastActivity.at < 8000 ? m.lastActivity : null;

  show(`
    <h2>MIDI</h2>
    <p class="sub">${act ? `${act.dir === 'in' ? 'In' : 'Out'}: <b>${esc(act.text)}</b>` : `${ins.length} input${ins.length === 1 ? '' : 's'} · ${outs.length} output${outs.length === 1 ? '' : 's'} connected`}</p>
    <h3>MIDI input</h3>
    <div class="wrap">
      <button class="pill small ${st.inId === 'all' ? 'on' : ''}" data-in="all">All inputs</button>
      <button class="pill small ${st.inId === '' ? 'on' : ''}" data-in="">Off</button>
      ${ins.map((p) => `<button class="pill small ${st.inId === p.id ? 'on' : ''}" data-in="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
    </div>
    ${ins.length === 0 ? '<p class="sub" style="margin-top:6px">Plug in a MIDI keyboard or pad controller and it will appear here automatically.</p>' : ''}
    <h3>Keyboard mode</h3>
    <div class="wrap">
      <button class="pill small ${st.inputMode === 'chromatic' ? 'on' : ''}" data-imode="chromatic">Chromatic (exact notes)</button>
      <button class="pill small ${st.inputMode === 'scale' ? 'on' : ''}" data-imode="scale">Scale snap</button>
    </div>
    <h3>Drum pads</h3>
    <div class="wrap">
      <button class="pill small ${st.drumMode === 'gm' ? 'on' : ''}" data-dmode="gm">GM drums</button>
      <button class="pill small ${st.drumMode === 'grid' ? 'on' : ''}" data-dmode="grid">5×5 grid (C1–C3)</button>
    </div>
    <h3>Channel routing</h3>
    <div class="wrap">
      <button class="pill small ${st.routing === 'omni' ? 'on' : ''}" data-route="omni">Selected track (Omni)</button>
      <button class="pill small ${st.routing === 'channel' ? 'on' : ''}" data-route="channel">Ch 1–12 per track</button>
    </div>
    <h3>MIDI output</h3>
    <div class="wrap">
      <button class="pill small ${!st.outId ? 'on' : ''}" data-out="">Off</button>
      ${outs.map((p) => `<button class="pill small ${st.outId === p.id ? 'on' : ''}" data-out="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
    </div>
    <div class="field" style="margin-top:14px"><span>Play Boba Beats sounds</span><span style="flex:1"></span><button class="toggle ${st.localSound ? 'on' : ''}" id="m-local" aria-label="Play Boba Beats sounds"></button></div>
    <p class="sub">Turn off to drive an external synth or DAW without doubling Boba Beats' audio.</p>
    <div class="field"><span>Send MIDI clock</span><span style="flex:1"></span><button class="toggle ${st.clockOut ? 'on' : ''}" id="m-clock" aria-label="Send MIDI clock"></button></div>
    <div class="wrap" style="margin-top:12px"><button class="pill" id="m-panic">All notes off</button></div>
  `, (root) => {
    const save = () => { S.saveSettings(app.settings); midiSheet(); };
    on(root, '[data-in]', (b) => { st.inId = b.dataset.in; save(); });
    on(root, '[data-imode]', (b) => { st.inputMode = b.dataset.imode; save(); });
    on(root, '[data-dmode]', (b) => { st.drumMode = b.dataset.dmode; save(); });
    on(root, '[data-route]', (b) => { st.routing = b.dataset.route; save(); });
    on(root, '[data-out]', (b) => {
      m.panic();
      st.outId = b.dataset.out;
      m.sendProgramChanges();
      save();
    });
    root.querySelector('#m-local').addEventListener('click', () => {
      st.localSound = !st.localSound;
      app.engine.setLocalSound(st.localSound);
      save();
    });
    root.querySelector('#m-clock').addEventListener('click', () => { st.clockOut = !st.clockOut; save(); });
    root.querySelector('#m-panic').addEventListener('click', () => { m.panic(); toast('MIDI notes cleared'); });
  });
}

export const openSheets = { spice, space, copyBlock, sampler, project, tempo, key, instrument, chord, grooves, addTrack, track, addSection, section, master, exporter, midi: midiSheet };
