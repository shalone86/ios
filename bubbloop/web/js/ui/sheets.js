// Bottom sheets: every picker and menu slides up from the bottom so the
// bubbles stay within reach of both thumbs.

import { KEY_NAMES, SCALES, CHORDS, STEP } from '../theory.js';
import { INSTRUMENTS, instrumentById } from '../instruments.js';
import { MASTERS, REVERBS, ECHOES } from '../graph.js';
import { PATTERNS } from '../patterns.js';
import * as S from '../state.js';
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
      <button class="pill" data-act="open">Open song file</button>
    </div>
    <input type="file" id="p-file" accept=".json,.bubbloop,application/json" hidden>
    ${others.length ? `<h3>Saved songs</h3><div class="list">${others.map((o) => `
      <div class="item"><button class="sp" data-open="${o.id}" style="text-align:left"><b>${esc(o.name)}</b><small>${Math.round(o.bpm)} bpm · ${ago(o.modified)}</small></button>
      <button class="pill round small danger" data-del="${o.id}" aria-label="Delete ${esc(o.name)}">${icon('trash')}</button></div>`).join('')}</div>` : ''}
    <h3>Settings</h3>
    <div class="field"><span>Buzz on tap</span><span style="flex:1"></span><button class="toggle ${st.haptics ? 'on' : ''}" data-set="haptics" aria-label="Haptics"></button></div>
    <div class="field"><span>Show note names</span><span style="flex:1"></span><button class="toggle ${st.names ? 'on' : ''}" data-set="names" aria-label="Note names"></button></div>
    <div class="field"><span>Smooth audio</span><span style="flex:1"></span><div class="wrap">${['auto', 'on', 'off'].map((v) => `<button class="pill small ${st.smooth === v ? 'on' : ''}" data-smooth="${v}">${v}</button>`).join('')}</div></div>
    <p class="sub">Crackle on Bluetooth? Set this to on. It uses a bigger audio buffer: steadier sound, slightly slower response.</p>
    <div class="field"><span>Click while playing</span><span style="flex:1"></span><button class="toggle ${st.metroPlay ? 'on' : ''}" data-set="metroPlay" aria-label="Metronome during playback"></button></div>
    <div class="field"><span>Tap timing</span><input type="range" id="p-offset" min="-80" max="160" step="5" value="${st.tapOffset}"><output id="p-offset-out">${st.tapOffset} ms</output></div>
    <p class="sub">If recorded notes land late, nudge tap timing up; if early, down.</p>
    <p class="sub center" style="margin-top:14px">Bubbloop · songs stay on this device</p>
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
      st.smooth = b.dataset.smooth;
      S.saveSettings(st);
      root.querySelectorAll('[data-smooth]').forEach((n) => n.classList.toggle('on', n === b));
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
        const loaded = S.repair(JSON.parse(await f.text()));
        if (!loaded) throw new Error('not a song');
        loaded.id = Math.random().toString(36).slice(2, 10);
        closeSheet();
        await openProject(loaded);
        toast(`Opened ${loaded.name}`);
      } catch (e) { toast('That file is not a Bubbloop song'); }
    });
    on(root, '[data-act]', async (b) => {
      const act = b.dataset.act;
      if (act === 'new') { closeSheet(); await openProject(S.newProject()); toast('Fresh song, fresh bubbles'); }
      else if (act === 'dup') { closeSheet(); await openProject(S.duplicateProject(p)); toast('Working on a copy'); }
      else if (act === 'demo') { closeSheet(); await openProject(S.demoProject()); toast('Press play, then poke around'); }
      else if (act === 'export') exporter();
      else if (act === 'open') file.click();
      else if (act === 'file') {
        try {
          const saved = await saveFile(`${p.name.replace(/[\\/:*?"<>|]/g, ' ')}.bubbloop.json`, 'application/json', new TextEncoder().encode(S.serialize(p)));
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
      root.querySelectorAll('[data-inst]').forEach((n) => n.classList.toggle('on', n === b));
      preview(track, true);
      renderAll(); touch();
    });
  });
}

function chord() {
  const t = curTrack();
  show(`
    <h2>Chords</h2>
    <p class="sub">One bubble, a whole chord. They are built from the song's key, so they always fit.</p>
    <div class="list">${CHORDS.map((c) => `<button class="item ${c.id === t.chord ? 'on' : ''}" data-chord="${c.id}"><span class="sp"><b>${c.name}</b><small>${c.hint}</small></span>${c.id === t.chord ? icon('check') : ''}</button>`).join('')}</div>
  `, (root) => {
    on(root, '[data-chord]', (b) => {
      t.chord = b.dataset.chord;
      closeSheet();
      renderAll(); touch(); preview(t, true);
    });
  });
}

function grooves() {
  const p = app.project;
  const t = curTrack().role === 'drums' ? curTrack() : p.tracks.find((x) => x.role === 'drums');
  if (!t) { toast('Add a drum track first'); return; }
  show(`
    <h2>Drum grooves</h2>
    <p class="sub">Drop a beat into this loop, then change it: tap extra hits over the top, or open Steps to edit it note by note.</p>
    <div class="cards">${PATTERNS.map((g) => `<button class="card" data-groove="${g.id}"><b>${g.name}</b><small>${g.mood}</small></button>`).join('')}</div>
  `, (root) => {
    on(root, '[data-groove]', async (b) => {
      const g = PATTERNS.find((x) => x.id === b.dataset.groove);
      S.applyPattern(p, p.cur, t.id, g.id);
      root.querySelectorAll('[data-groove]').forEach((n) => n.classList.toggle('on', n === b));
      afterEdit();
      await app.engine.wake(p);
      if (!app.engine.playing) app.engine.play();
      toast(g.swing ? `${g.name} · swing ${Math.round(g.swing * 100)}%` : g.name);
    });
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
  return esc(m.lufs ? `${hint}. Levelled to ${m.lufs} LUFS with a peak limiter.` : `${hint}. Peaks are kept safe and nothing else is changed.`);
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
    ${c.format === 'midi' ? '' : `
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

export const openSheets = { spice, space,  project, tempo, key, instrument, chord, grooves, addTrack, track, addSection, section, master, exporter };
