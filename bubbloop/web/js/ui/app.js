// Bubbloop UI: wires the bubbles, pads and buttons to the engine.

import { ROWS, COLS, STEP, BAR, KEY_NAMES, scaleById, chordLabel, cellNotes, CHORDS } from '../theory.js';
import { Engine } from '../engine.js';
import { DRUM_PADS } from '../drums.js';
import { FX } from '../graph.js';
import { instrumentById } from '../instruments.js';
import * as S from '../state.js';
import { haptic, keepAwake, onBack, onPause, exitApp } from '../platform.js';
import { mountIcons, icon, FACE, mascot, ROLE_COLOR, ROLE_COLOR_LO, FX_ART } from './art.js';
import { Particles } from './particles.js';
import { openSheets, closeSheet, sheetIsOpen } from './sheets.js';

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'), splash: $('splash'), projectName: $('project-name'), tempo: $('tempo-label'), key: $('key-label'),
  sections: $('sections'), bars: $('btn-bars'), undo: $('btn-undo'), play: $('btn-play'), rec: $('btn-rec'),
  map: $('loopmap'), count: $('count'), hint: $('hint'), tracks: $('tracks'), tools: $('tools'), steps: $('steps'),
  stage: $('stage'), grid: $('grid'), fx: $('fxview'), mix: $('mixview'), song: $('songview'), tabs: $('tabs'), toast: $('toast'),
};

export const app = {
  engine: new Engine(),
  project: null,
  settings: S.loadSettings(),
  view: 'play',
  trackId: null,
  focus: { r: 0, c: 0 },
  stepsOn: false,
  stepBar: 0,
  eraser: false,
  songSel: -1,
  fxTrack: false,           // FX pads act on the current track rather than the whole mix
  nowBlock: -1,
};
const engine = app.engine;
const particles = new Particles($('particles'));

export const curTrack = () => app.project.tracks.find((t) => t.id === app.trackId) || app.project.tracks[0];
const curSection = () => app.project.sections[app.project.cur];
const variantOf = (track) => app.project.tracks.filter((t) => t.role === track.role).indexOf(track);
export const trackMascot = (track, cls = '') => mascot(track.role, variantOf(track), cls);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ---------- saving ----------

let saveTimer = null;
export function touch() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => S.saveProject(app.project), 700);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (app.project) S.saveProject(app.project);
}

let toastTimer = null;
export function toast(msg, ms = 1900) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

// ---------- top bar + transport ----------

function renderTop() {
  const p = app.project;
  el.projectName.textContent = p.name;
  el.tempo.textContent = Math.round(p.bpm);
  el.key.textContent = `${KEY_NAMES[p.key]} ${scaleById(p.scale).name.toLowerCase()}`;
}

// Re-rendering a strip must not throw away where it was scrolled to.
function keepScroll(node, fn) {
  const x = node.scrollLeft, y = node.scrollTop;
  fn();
  node.scrollLeft = x; node.scrollTop = y;
}

function renderSections() { keepScroll(el.sections, drawSections); }
function drawSections() {
  const p = app.project;
  let html = '';
  if (engine.mode === 'song') {
    html = p.song.map((b, i) => `<button class="sec block ${i === app.nowBlock ? 'cur' : ''} ${i === app.songSel && i !== app.nowBlock ? 'queued-off sel' : ''}" data-block="${i}">${S.SECTION_NAMES[b.sec]}${b.rep > 1 ? `<small>×${b.rep}</small>` : ''}</button>`).join('');
    if (!p.song.length) html = '<span class="label" style="font-size:12.500px;opacity:.85;padding:0 4px">Song is empty: add blocks below</span>';
  } else {
    html = p.sections.map((s, i) => `<button class="sec ${i === p.cur ? 'cur' : ''} ${engine.queued === i ? 'queued' : ''} ${S.sectionIsEmpty(s) ? '' : 'has'}" data-sec="${i}">${S.SECTION_NAMES[i]}</button>`).join('');
    if (p.sections.length < S.MAX_SECTIONS) html += '<button class="sec add" data-sec="add" aria-label="Add section">+</button>';
  }
  el.sections.innerHTML = html;
  el.bars.textContent = `${curSection().bars} bar${curSection().bars > 1 ? 's' : ''}`;
  el.bars.hidden = engine.mode === 'song';
}

function renderTransport() {
  el.play.classList.toggle('on', engine.playing);
  el.play.querySelector('.ico').dataset.ico = engine.playing ? 'stop' : 'play';
  mountIcons(el.play);
  el.rec.classList.toggle('on', engine.recording);
  el.undo.toggleAttribute('disabled', !S.canUndo());
  keepAwake(engine.playing);
  if (!engine.playing) { el.count.innerHTML = ''; app.nowBlock = -1; }
  updateHint();
}

function updateHint() {
  const empty = S.sectionIsEmpty(curSection());
  let text = '';
  if (!engine.playing && empty && engine.mode === 'loop') text = 'Tap bubbles to play · the pink button loops it';
  else if (engine.recording && empty && engine.mode === 'loop') text = 'Recording… play something!';
  el.hint.textContent = text;
}

// ---------- track pods ----------

function renderTracks() { keepScroll(el.tracks, drawTracks); }
function drawTracks() {
  const p = app.project;
  const cur = curTrack();
  let html = p.tracks.map((t) => `
    <button class="pod ${t.id === cur.id ? 'cur' : ''} ${t.mute ? 'muted' : ''}" data-track="${t.id}">
      ${trackMascot(t)}
      <span class="name">${esc(t.name)}</span>
      <span class="mute" data-mute="${t.id}" role="button" aria-label="Mute ${esc(t.name)}">${t.mute ? 'zzz' : 'on'}</span>
    </button>`).join('');
  if (p.tracks.length < S.MAX_TRACKS) html += '<button class="pod add" data-track="add" aria-label="Add track">+</button>';
  el.tracks.innerHTML = html;
}

// ---------- tool row ----------

function renderTools() { keepScroll(el.tools, drawTools); }
function drawTools() {
  const p = app.project, t = curTrack();
  const chip = (id, label, on = false, extra = '') => `<button class="pill small ${on ? 'on' : ''} ${extra}" data-tool="${id}">${label}</button>`;
  let html = '';
  if (app.view === 'play') {
    if (t.role === 'drums') html += chip('grooves', 'Grooves ▾');
    else {
      html += chip('inst', esc(instrumentById(t.inst).name) + ' ▾');
      const ch = CHORDS.find((c) => c.id === t.chord) || CHORDS[0];
      html += chip('chord', (t.chord === 'off' ? 'Chords: off' : 'Chords: ' + ch.name) + ' ▾', t.chord !== 'off');
      html += chip('acc', engine.acc > 0 ? '♯ sharp' : engine.acc < 0 ? '♭ flat' : '♮', engine.acc !== 0);
      html += `<span class="stepper"><button data-tool="oct-">−</button><span>oct ${t.oct > 0 ? '+' : ''}${t.oct}</span><button data-tool="oct+">+</button></span>`;
    }
    html += chip('steps', icon('steps') + 'Steps', app.stepsOn);
    html += chip('eraser', icon('eraser') + 'Erase', app.eraser, 'warn');
    html += chip('clear', 'Clear');
    html += chip('redo', icon('redo'), false, S.canRedo() ? '' : 'dim');
  } else if (app.view === 'fx') {
    const n = curSection().fx.length + p.song.reduce((a, b) => a + b.fx.length, 0);
    html += chip('fxtarget', app.fxTrack ? `On: ${esc(t.name)} only` : 'On: whole mix', app.fxTrack);
    html += '<span class="label">Hold a pad. Record to keep it.</span>';
    if (n) html += chip('clearfx', `Clear ${n} recorded`);
  } else if (app.view === 'mix') {
    html += '<span class="label">Balance your band</span>';
  } else if (app.view === 'song') {
    const b = p.song[app.songSel];
    if (b) {
      html += chip('blk-sec', `Plays ${S.SECTION_NAMES[b.sec]} ▾`);
      html += chip('blk-rep', `×${b.rep}`);
      html += chip('blk-left', icon('left')) + chip('blk-right', icon('right'));
      html += chip('blk-copy', icon('copy') + 'Copy') + chip('blk-del', icon('trash'));
    } else if (p.song.length) {
      html += '<span class="label">Tap a bubble to rest a track. Hold one for fills and energy.</span>';
    } else {
      html += '<span class="label">Arrange your loops into a whole song</span>';
    }
  }
  el.tools.innerHTML = html;
}

// ---------- bubble grid ----------

function renderGrid() {
  const p = app.project, t = curTrack();
  const drums = t.role === 'drums';
  const chords = !drums && t.chord && t.chord !== 'off';
  const cells = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      let cls, label = '';
      if (drums) {
        cls = 'kind-' + DRUM_PADS[idx].kind;
        label = DRUM_PADS[idx].name;
      } else {
        cls = 'hue-' + c + (c === 0 ? ' root' : '');
        if (chords) label = chordLabel(p, c, t.chord);
        else if (app.settings.names) label = KEY_NAMES[cellNotes(p, t, r, c)[0] % 12];
      }
      const size = drums ? 92 : 95 - r * 4;
      const bob = 3.200 + ((idx * 37) % 17) / 10, delay = -((idx * 53) % 29) / 10;
      cells.push(`<div class="cell ${cls}" data-r="${r}" data-c="${c}"><div class="bub" style="--k:${size / 100};--bob:${bob}s;--delay:${delay}s"><div class="orb ${label ? 'labeled' : ''}"><div class="face">${FACE}</div>${label ? `<span class="lbl">${esc(label)}</span>` : ''}<i class="badge"></i></div></div></div>`);
    }
  }
  el.grid.innerHTML = cells.join('');
  el.grid.classList.toggle('erasing', app.eraser);
  updateBadges();
}

const cellEl = (r, c) => el.grid.children[(ROWS - 1 - r) * COLS + c];

// The grid is the largest square that fits the stage.
function fitGrid() {
  const b = el.stage.getBoundingClientRect();
  const size = Math.max(150, Math.floor(Math.min(b.width, b.height)));
  el.grid.style.width = el.grid.style.height = `${size}px`;
  el.grid.style.setProperty('--cell', `${size / COLS}px`);
}

function updateBadges() {
  const list = S.trackEvents(app.project, app.project.cur, curTrack().id);
  const has = new Set(list.map((e) => e.r * COLS + e.c));
  for (const cell of el.grid.children) {
    const idx = +cell.dataset.r * COLS + +cell.dataset.c;
    cell.classList.toggle('has', has.has(idx));
    cell.classList.toggle('focus', app.stepsOn && +cell.dataset.r === app.focus.r && +cell.dataset.c === app.focus.c);
  }
}

function cellColor(cell) {
  return getComputedStyle(cell.firstElementChild).getPropertyValue('--hue').trim() || '#fff';
}

function sparkle(cell, n = 4) {
  const b = cell.getBoundingClientRect();
  particles.burst(b.left + b.width / 2, b.top + b.height / 2, cellColor(cell), n, b.width * 0.4);
}

const pointers = new Map();

function pressCell(cell, e) {
  const r = +cell.dataset.r, c = +cell.dataset.c, t = curTrack();
  if (app.eraser) {
    if (S.clearCell(app.project, app.project.cur, t.id, r, c)) {
      sparkle(cell, 7);
      haptic();
      afterEdit();
    }
    return null;
  }
  const b = cell.getBoundingClientRect();
  const dx = (e.clientX - (b.left + b.width / 2)) / (b.width / 2), dy = (e.clientY - (b.top + b.height / 2)) / (b.height / 2);
  const vel = Math.max(0.5, Math.min(1, 1.050 - 0.5 * Math.pow(Math.hypot(dx, dy), 1.5)));
  const id = engine.noteOn(t, r, c, vel);
  cell.classList.add('on');
  sparkle(cell, 3);
  if (app.settings.haptics) haptic();
  if (app.stepsOn && (app.focus.r !== r || app.focus.c !== c)) {
    app.focus = { r, c };
    renderSteps();
    updateBadges();
  } else {
    app.focus = { r, c };
  }
  return id;
}

function releasePointer(pid) {
  const cur = pointers.get(pid);
  if (!cur) return;
  pointers.delete(pid);
  if (cur.id) engine.noteOff(cur.id);
  if (![...pointers.values()].some((p) => p.cell === cur.cell)) cur.cell.classList.remove('on');
}

function bindGrid() {
  el.grid.addEventListener('pointerdown', async (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    if (!engine.ready) await engine.wake(app.project);
    pointers.set(e.pointerId, { cell, id: pressCell(cell, e) });
  });
  el.grid.addEventListener('pointermove', (e) => {
    const cur = pointers.get(e.pointerId);
    if (!cur) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const cell = hit && hit.closest && hit.closest('#grid .cell');
    if (!cell || cell === cur.cell) return;
    // sliding across bubbles plays each one in turn
    releasePointer(e.pointerId);
    pointers.set(e.pointerId, { cell, id: pressCell(cell, e) });
  });
  const up = (e) => releasePointer(e.pointerId);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  el.grid.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- step strip ----------

function renderSteps() {
  el.steps.hidden = !(app.stepsOn && app.view === 'play');
  if (el.steps.hidden) return;
  const p = app.project, t = curTrack(), sec = curSection();
  app.stepBar = Math.min(app.stepBar, sec.bars - 1);
  const { r, c } = app.focus;
  const drums = t.role === 'drums';
  const name = drums ? DRUM_PADS[r * COLS + c].name : (t.chord !== 'off' ? chordLabel(p, c, t.chord) : KEY_NAMES[cellNotes(p, t, r, c)[0] % 12]);
  const list = S.trackEvents(p, p.cur, t.id);
  const base = app.stepBar * 16;
  let html = `<div class="head"><span>Steps for <b>${esc(name)}</b>. Tap a bubble to pick another.</span><span class="sp"></span>`;
  if (sec.bars > 1) html += `<span class="stepper"><button data-step="prev">‹</button><span>bar ${app.stepBar + 1}/${sec.bars}</span><button data-step="next">›</button></span>`;
  html += '</div><div class="row">';
  const cell = cellEl(r, c);
  const hue = cell ? cellColor(cell) : '#ff9cc2';
  for (let s = 0; s < 16; s++) {
    const t0 = (base + s) * STEP;
    const on = list.some((e) => e.r === r && e.c === c && e.t >= t0 && e.t < t0 + STEP);
    html += `<button class="step ${s % 4 === 0 ? 'beat' : ''} ${on ? 'on' : ''}" style="--hue:${hue}" data-step="${base + s}"></button>`;
  }
  el.steps.innerHTML = html + '</div>';
}

// ---------- FX pads ----------

function renderFx() {
  const latch = app.project.latch || {};
  el.fx.innerHTML = FX.map((f, i) => `
    <div class="fx fx-${i} ${f.zones ? 'zoned' : ''} ${latch[f.id] ? 'latched on' : ''}" data-fx="${f.id}">
      ${FX_ART[f.id]}
      <b>${f.name}</b><small>${f.sub}</small>
      ${f.zones ? `<div class="zones">${f.zones.map((z) => `<i>${z}</i>`).join('')}</div>` : ''}
      <button class="lock" data-lock="${f.id}" aria-label="Keep ${f.name} on">${icon('lock')}</button>
    </div>`).join('');
}

function bindFx() {
  const held = new Map();
  const zoneOf = (pad, f, x) => {
    if (!f.zones) return null;
    const b = pad.getBoundingClientRect();
    return Math.max(0, Math.min(f.zones.length - 1, Math.floor(((x - b.left) / b.width) * f.zones.length)));
  };
  const showZone = (pad, z) => pad.querySelectorAll('.zones i').forEach((n, i) => n.classList.toggle('z', i === z));
  el.fx.addEventListener('pointerdown', async (e) => {
    const pad = e.target.closest('.fx');
    if (!pad) return;
    e.preventDefault();
    if (!engine.ready) await engine.wake(app.project);
    const f = FX.find((x) => x.id === pad.dataset.fx);
    if (e.target.closest('.lock')) {
      const on = !app.project.latch[f.id];
      engine.setLatch(f.id, on, f.zones ? Math.floor(f.zones.length / 2) : null);
      pad.classList.toggle('latched', on);
      pad.classList.toggle('on', on);
      showZone(pad, on && f.zones ? Math.floor(f.zones.length / 2) : -1);
      toast(on ? `${f.name} stays on` : `${f.name} released`);
      touch();
      return;
    }
    const z = zoneOf(pad, f, e.clientX);
    const tr = app.fxTrack ? curTrack().id : null;
    engine.fxDown(f.id, z, tr);
    pad.classList.add('on');
    showZone(pad, z);
    if (app.settings.haptics) haptic();
    const b = pad.getBoundingClientRect();
    particles.burst(e.clientX, e.clientY, getComputedStyle(pad).getPropertyValue('--hue').trim(), 6, b.width * 0.3);
    held.set(e.pointerId, { pad, f, z, tr });
  });
  el.fx.addEventListener('pointermove', (e) => {
    const h = held.get(e.pointerId);
    if (!h || !h.f.zones) return;
    const z = zoneOf(h.pad, h.f, e.clientX);
    if (z === h.z) return;
    h.z = z;
    engine.fxDown(h.f.id, z, h.tr);       // re-trigger with the new setting
    showZone(h.pad, z);
  });
  const up = (e) => {
    const h = held.get(e.pointerId);
    if (!h) return;
    held.delete(e.pointerId);
    engine.fxUp(h.f.id, h.tr);
    if (!app.project.latch[h.f.id]) { h.pad.classList.remove('on'); showZone(h.pad, -1); }
    if (engine.recording) renderTools();
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  el.fx.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- mixer ----------

function renderMix() { keepScroll(el.mix, drawMix); }
function drawMix() {
  const p = app.project, cur = curTrack();
  const slider = (id, key, val) => `<input type="range" min="0" max="100" value="${Math.round(val * 100)}" data-mix="${id}:${key}" style="--fill:${Math.round(val * 100)}%">`;
  el.mix.innerHTML = p.tracks.map((t) => `
    <div class="strip ${t.id === cur.id ? 'cur' : ''} ${t.mute ? 'muted' : ''}" data-strip="${t.id}">
      <div class="row1">
        ${trackMascot(t)}
        <button class="who" data-mixinst="${t.id}"><b>${esc(t.name)}</b><small>${t.role === 'drums' ? 'Grooves' : esc(instrumentById(t.inst).name)} ▾</small></button>
        <button class="pill small ${t.mute ? '' : 'on'}" data-mixmute="${t.id}">${t.mute ? 'zzz' : 'on'}</button>
        <button class="pill round small" data-mixmore="${t.id}" aria-label="More">⋯</button>
      </div>
      <div class="sliders">
        <div><label>Volume</label>${slider(t.id, 'vol', t.vol)}</div>
        <div><label>Cloud</label>${slider(t.id, 'rev', t.rev)}</div>
        <div><label>Echo</label>${slider(t.id, 'dly', t.dly)}</div>
      </div>
    </div>`).join('') + `
    <div class="mixfoot">
      ${p.tracks.length < S.MAX_TRACKS ? '<button class="pill small" data-mixadd="1">+ Add a track</button>' : ''}
      <button class="pill small" data-mixmaster="1">Mastering: ${esc(p.master)} ▾</button>
    </div>`;
}

function bindMix() {
  el.mix.addEventListener('input', (e) => {
    const m = e.target.dataset.mix;
    if (!m) return;
    const [id, key] = m.split(':');
    const t = app.project.tracks.find((x) => x.id === id);
    t[key] = +e.target.value / 100;
    e.target.style.setProperty('--fill', e.target.value + '%');
    engine.syncTrack(t);
    touch();
  });
  el.mix.addEventListener('click', (e) => {
    const d = e.target.closest('button')?.dataset || {};
    if (d.mixinst) { selectTrack(d.mixinst); openSheets.instrument(curTrack()); }
    else if (d.mixmute) toggleMute(d.mixmute);
    else if (d.mixmore) openSheets.track(app.project.tracks.find((t) => t.id === d.mixmore));
    else if (d.mixadd) openSheets.addTrack();
    else if (d.mixmaster) openSheets.master();
  });
}

// ---------- song matrix ----------

function renderSong() {
  const old = el.song.querySelector('.matrix');
  const x = old ? old.scrollLeft : 0, y = old ? old.scrollTop : 0;
  drawSong();
  const now = el.song.querySelector('.matrix');
  if (now) { now.scrollLeft = x; now.scrollTop = y; }
}
function drawSong() {
  const p = app.project;
  if (!p.song.length) {
    el.song.innerHTML = `<div class="matrix"><div class="song-empty">
      <p>Song mode strings your loops together. Each column is a block of the song; each bubble wakes or rests one track.</p>
      <button class="pill on" data-song="build">Start with my sections</button>
      <button class="pill" data-song="add">+ Add one block</button>
    </div></div>`;
    return;
  }
  const head = p.song.map((b, i) => `<th class="${i === app.songSel ? 'col-sel' : ''} ${i === app.nowBlock ? 'col-now' : ''}" data-col="${i}"><button class="colhead" data-block="${i}">${S.SECTION_NAMES[b.sec]}<small>${b.rep > 1 ? '×' + b.rep + ' · ' : ''}${p.sections[b.sec].bars * b.rep} bar${p.sections[b.sec].bars * b.rep > 1 ? 's' : ''}</small></button></th>`).join('');
  const rows = p.tracks.map((t) => {
    const hue = ROLE_COLOR[t.role], lo = ROLE_COLOR_LO[t.role];
    const cells = p.song.map((b, i) => {
      const empty = !(p.sections[b.sec].ev[t.id] || []).length;
      return `<td class="${i === app.songSel ? 'col-sel' : ''} ${i === app.nowBlock ? 'col-now' : ''}" data-col="${i}"><button class="sb ${b.off[t.id] ? 'off' : ''} ${empty ? 'empty' : ''} ${b.sp && b.sp[t.id] ? (b.sp[t.id].fill ? 'fill' : 'spiced') : ''}" style="--hue:${hue};--hue-lo:${lo}" data-cell="${i}:${t.id}" aria-label="${esc(t.name)} in block ${i + 1}"><i></i></button></td>`;
    }).join('');
    return `<tr><th class="rowhead">${trackMascot(t)}</th>${cells}<td></td></tr>`;
  }).join('');
  const secs = Math.round(S.songSeconds(p));
  el.song.innerHTML = `
    <div class="matrix"><table>
      <thead><tr><th class="rowhead">blocks</th>${head}<th><button class="addcol" data-song="add" aria-label="Add block">+</button></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="songfoot"><span>${S.songBars(p)} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span><span class="sp"></span>
      <button class="pill small ${engine.loopSong ? 'on' : ''}" data-song="loop">${icon('loop')}Repeat</button>
      <button class="pill small" data-song="export">${icon('share')}Export</button></div>`;
}

function markSongColumn() {
  el.song.querySelectorAll('[data-col]').forEach((n) => n.classList.toggle('col-now', +n.dataset.col === app.nowBlock));
}

function bindSong() {
  longPress(el.song, '.sb', (node) => {
    const [i, id] = node.dataset.cell.split(':');
    if (app.settings.haptics) haptic();
    openSheets.spice(+i, id);
  });
  el.song.addEventListener('click', (e) => {
    const d = e.target.closest('button')?.dataset || {};
    const p = app.project;
    if (d.song === 'build') {
      S.pushUndo(p);
      p.sections.forEach((s, i) => { if (!S.sectionIsEmpty(s) || i === 0) p.song.push({ sec: i, rep: 2, off: {}, fx: [] }); });
      app.songSel = 0;
    } else if (d.song === 'add') {
      S.addBlock(p);
      app.songSel = p.song.length - 1;
    } else if (d.song === 'loop') {
      engine.loopSong = !engine.loopSong;
    } else if (d.song === 'export') {
      openSheets.exporter();
      return;
    } else if (d.block != null) {
      app.songSel = app.songSel === +d.block ? -1 : +d.block;
      engine.songFrom = Math.max(0, app.songSel);
    } else if (d.cell) {
      const [i, id] = d.cell.split(':');
      S.pushUndo(p);
      const b = p.song[+i];
      if (b.off[id]) delete b.off[id]; else b.off[id] = true;
      const btn = e.target.closest('button');
      btn.classList.toggle('off', !!b.off[id]);
      if (!b.off[id]) { const r = btn.getBoundingClientRect(); particles.burst(r.left + r.width / 2, r.top + r.height / 2, btn.style.getPropertyValue('--hue'), 4, 16); }
      if (app.settings.haptics) haptic();
      touch();
      renderTransport();
      return;
    } else return;
    touch();
    renderSong(); renderTools(); renderSections(); renderTransport();
  });
}

// ---------- loop map ----------

const mapLayer = document.createElement('canvas');

// rounded bar, with a fallback for canvases that predate roundRect()
function pill(g, x, y, w, h) {
  const r = Math.min(h / 2, w / 2);
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else {
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  g.fill();
}
let mapDirty = true;

function sizeMap() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const b = el.map.getBoundingClientRect();
  const w = Math.max(10, Math.round(b.width * dpr)), h = Math.max(10, Math.round(b.height * dpr));
  if (el.map.width !== w || el.map.height !== h) {
    el.map.width = mapLayer.width = w;
    el.map.height = mapLayer.height = h;
    mapDirty = true;
  }
  return dpr;
}

function drawMapLayer(secIdx) {
  const dpr = sizeMap();
  const p = app.project, sec = p.sections[secIdx] || curSection();
  const len = S.sectionLen(sec);
  const g = mapLayer.getContext('2d');
  const W = mapLayer.width, H = mapLayer.height;
  g.clearRect(0, 0, W, H);
  for (let t = 0; t <= len; t += BAR / 4) {
    const x = Math.round((t / len) * W) + 0.5;
    g.strokeStyle = t % BAR === 0 ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.1)';
    g.lineWidth = dpr;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  const lanes = p.tracks.length + 1;
  const pad = 4 * dpr, laneH = (H - pad * 2) / lanes;
  const cur = curTrack();
  p.tracks.forEach((t, i) => {
    const top = pad + i * laneH;
    if (t.id === cur.id) { g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(0, top, W, laneH); }
    g.fillStyle = ROLE_COLOR[t.role];
    g.globalAlpha = t.mute ? 0.3 : 1;
    for (const e of sec.ev[t.id] || []) {
      const x = (e.t / len) * W;
      if (t.role === 'drums') {
        const r = Math.max(1.200 * dpr, laneH * 0.3 * (0.6 + 0.4 * e.v));
        g.beginPath(); g.arc(x + r, top + laneH / 2, r, 0, Math.PI * 2); g.fill();
      } else {
        const hgt = Math.max(2 * dpr, laneH * 0.4);
        const y = top + (laneH - hgt) * (1 - (e.r * COLS + e.c) / 24);
        const w = Math.max(3 * dpr, (e.d / len) * W - dpr);
        pill(g, x, y, w, hgt);
      }
    }
    g.globalAlpha = 1;
  });
  const fxTop = pad + p.tracks.length * laneH;
  const blk = app.nowBlock >= 0 ? p.song[app.nowBlock] : null;
  g.fillStyle = 'rgba(255,255,255,.85)';
  for (const e of sec.fx) {
    pill(g, (e.t / len) * W, fxTop + laneH * 0.2, Math.max(3 * dpr, (e.d / len) * W), laneH * 0.6);
  }
  if (blk && blk.fx.length) {
    g.fillStyle = '#ffd966';
    for (const e of blk.fx) {
      const local = e.t % len;
      pill(g, (local / len) * W, fxTop + laneH * 0.2, Math.max(3 * dpr, (e.d / len) * W), laneH * 0.6);
    }
  }
  mapDirty = false;
}

let shownSec = 0;
function drawMap(pos) {
  const secIdx = pos && pos.seg ? pos.seg.secIdx : app.project.cur;
  if (mapDirty || secIdx !== shownSec) { shownSec = secIdx; drawMapLayer(secIdx); }
  const g = el.map.getContext('2d');
  const W = el.map.width, H = el.map.height;
  g.clearRect(0, 0, W, H);
  g.drawImage(mapLayer, 0, 0);
  if (pos && pos.seg) {
    const x = (pos.local / pos.len) * W;
    const grad = g.createLinearGradient(x - 26, 0, x, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,.28)');
    g.fillStyle = grad;
    g.fillRect(x - 26, 0, 26, H);
    g.fillStyle = engine.recording ? '#ff7d98' : '#fff';
    g.fillRect(x - 1, 0, 2.500, H);
  }
}

// ---------- the frame loop ----------

const litTimers = new Map();
function light(cell, seconds) {
  cell.classList.add('lit');
  clearTimeout(litTimers.get(cell));
  litTimers.set(cell, setTimeout(() => cell.classList.remove('lit'), Math.max(110, Math.min(600, seconds * 1000))));
}

function frame() {
  requestAnimationFrame(frame);
  if (!engine.ready || !app.project) return;
  const lat = engine.ctx.outputLatency || 0;
  const cur = curTrack();
  for (const v of engine.drainViz(engine.now - lat)) {
    if (v.kind === 'note') {
      if (app.view === 'play' && v.track === cur.id) {
        const cell = cellEl(v.r, v.c);
        if (cell) light(cell, v.d);
      }
      const pod = el.tracks.querySelector(`[data-track="${v.track}"]`);
      if (pod && !pod.classList.contains('hit')) {
        pod.classList.add('hit');
        setTimeout(() => pod.classList.remove('hit'), 110);
      }
    } else if (v.kind === 'count') {
      el.count.innerHTML = `<span>${v.n}</span>`;
    } else if (v.kind === 'step') {
      if (v.step === 0) {
        el.count.innerHTML = '';
        if (v.seg.block !== app.nowBlock) {
          app.nowBlock = v.seg.block;
          if (engine.mode === 'song') { renderSections(); markSongColumn(); mapDirty = true; }
        }
      }
      if (!el.steps.hidden) {
        const base = app.stepBar * 16;
        el.steps.querySelectorAll('.step').forEach((n, i) => n.classList.toggle('now', base + i === v.step));
      }
    } else if (v.kind === 'section') {
      renderSections(); renderSteps(); updateBadges(); updateHint();
      mapDirty = true;
    }
  }
  drawMap(engine.position());
}

// random blinks keep the bubbles alive without animating all of them
setInterval(() => {
  if (app.view !== 'play' || document.hidden) return;
  const cells = el.grid.children;
  for (let i = 0; i < 2; i++) {
    const cell = cells[Math.floor(Math.random() * cells.length)];
    if (!cell) continue;
    cell.classList.add('blink');
    setTimeout(() => cell.classList.remove('blink'), 130);
  }
}, 1700);

// ---------- actions ----------

export function renderAll() {
  renderTop(); renderSections(); renderTransport(); renderTracks(); renderTools();
  renderGrid(); renderSteps(); renderFx(); renderMix(); renderSong();
  mapDirty = true;
}

export function afterEdit() {
  mapDirty = true;
  updateBadges();
  renderSteps();
  renderSections();
  renderTransport();
  if (app.view === 'play') renderTools();
  if (app.view === 'song') renderSong();
  touch();
}

export function selectTrack(id) {
  app.trackId = id;
  renderTracks(); renderTools(); renderGrid(); renderSteps();
  if (app.view === 'mix') renderMix();
  mapDirty = true;
}

export function toggleMute(id) {
  const t = app.project.tracks.find((x) => x.id === id);
  t.mute = !t.mute;
  engine.syncTrack(t);
  renderTracks();
  if (app.view === 'mix') renderMix();
  mapDirty = true;
  if (app.settings.haptics) haptic();
  touch();
}

export function setView(view) {
  app.view = view;
  if (view === 'song' && engine.mode !== 'song') { if (engine.playing) engine.stop(); engine.mode = 'song'; }
  if (view === 'play' && engine.mode !== 'loop') { if (engine.playing) engine.stop(); engine.mode = 'loop'; }
  el.grid.hidden = view !== 'play';
  el.fx.hidden = view !== 'fx';
  el.mix.hidden = view !== 'mix';
  el.song.hidden = view !== 'song';
  el.tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  for (const pid of [...pointers.keys()]) releasePointer(pid);
  renderSections(); renderTransport(); renderTools(); renderSteps();
  fitGrid();
  if (view === 'mix') renderMix();
  if (view === 'song') renderSong();
  if (view === 'fx') renderFx();
  mapDirty = true;
}

export async function openProject(p) {
  saveNow();
  S.clearUndo();
  app.project = p;
  app.trackId = (p.tracks.find((t) => t.role === 'melody') || p.tracks[0]).id;
  app.songSel = -1;
  app.focus = { r: 0, c: 0 };
  engine.songFrom = 0;
  await engine.load(p);
  renderAll();
  touch();
}

function longPress(target, selector, handler) {
  let timer = null, fired = false;
  target.addEventListener('pointerdown', (e) => {
    const node = e.target.closest(selector);
    fired = false;
    if (!node) return;
    timer = setTimeout(() => { fired = true; handler(node, e); }, 480);
  });
  const cancel = () => clearTimeout(timer);
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointerleave', cancel);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 8) cancel(); });
  target.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  target.addEventListener('contextmenu', (e) => e.preventDefault());
}

function bind() {
  $('btn-project').onclick = () => openSheets.project();
  $('btn-tempo').onclick = () => openSheets.tempo();
  $('btn-key').onclick = () => openSheets.key();
  $('btn-export').onclick = () => openSheets.exporter();

  el.play.onclick = async () => {
    await engine.wake(app.project);
    if (engine.playing) engine.stop();
    else if (engine.mode === 'song' && !app.project.song.length) toast('Add a block to your song first');
    else engine.play();
  };
  el.rec.onclick = async () => {
    await engine.wake(app.project);
    if (engine.mode === 'song' && !app.project.song.length) { toast('Add a block to your song first'); return; }
    if (!engine.playing) engine.play({ record: true, countIn: true });
    else engine.setRecording(!engine.recording);
  };
  el.undo.onclick = () => {
    if (S.undo(app.project)) { afterStructureChange(); toast('Undone'); }
  };
  el.bars.onclick = () => {
    const next = { 1: 2, 2: 4, 4: 8, 8: 1 }[curSection().bars];
    S.setBars(app.project, app.project.cur, next);
    afterEdit();
    toast(next > 1 ? `Loop is ${next} bars` : 'Loop is 1 bar');
  };

  el.sections.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.block != null) {
      app.songSel = +b.dataset.block;
      engine.songFrom = app.songSel;
      renderSections(); renderTools();
      if (app.view === 'song') renderSong();
    } else if (b.dataset.sec === 'add') openSheets.addSection();
    else {
      engine.setSection(+b.dataset.sec);
      if (!engine.playing) afterStructureChange(false);
      else renderSections();
    }
  });
  longPress(el.sections, '[data-sec]:not(.add)', (node) => openSheets.section(+node.dataset.sec));

  el.tracks.addEventListener('click', (e) => {
    const mute = e.target.closest('[data-mute]');
    if (mute) { toggleMute(mute.dataset.mute); return; }
    const pod = e.target.closest('.pod');
    if (!pod) return;
    if (pod.dataset.track === 'add') openSheets.addTrack();
    else selectTrack(pod.dataset.track);
  });
  longPress(el.tracks, '.pod:not(.add)', (node) => openSheets.track(app.project.tracks.find((t) => t.id === node.dataset.track)));

  el.tools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const p = app.project, t = curTrack(), tool = b.dataset.tool;
    if (tool === 'acc') { engine.acc = engine.acc === 0 ? 1 : engine.acc === 1 ? -1 : 0; renderTools(); }
    else if (tool === 'fxtarget') { app.fxTrack = !app.fxTrack; renderTools(); }
    else if (tool === 'inst') openSheets.instrument(t);
    else if (tool === 'grooves') openSheets.grooves();
    else if (tool === 'chord') openSheets.chord();
    else if (tool === 'oct-' || tool === 'oct+') {
      t.oct = Math.max(-2, Math.min(2, t.oct + (tool === 'oct+' ? 1 : -1)));
      renderTools(); renderGrid(); touch();
    } else if (tool === 'steps') { app.stepsOn = !app.stepsOn; renderTools(); renderSteps(); updateBadges(); fitGrid(); }
    else if (tool === 'eraser') {
      app.eraser = !app.eraser;
      renderTools();
      el.grid.classList.toggle('erasing', app.eraser);
      if (app.eraser) toast('Tap a bubble to wipe its notes');
    } else if (tool === 'clear') {
      if (!S.trackEvents(p, p.cur, t.id).length) { toast('Nothing to clear here'); return; }
      S.clearTrack(p, p.cur, t.id);
      afterEdit();
      toast(`${t.name} cleared · undo to bring it back`);
    } else if (tool === 'redo') { if (S.redo(p)) { afterStructureChange(); toast('Redone'); } }
    else if (tool === 'clearfx') { S.clearFx(p, p.cur); afterEdit(); renderTools(); }
    else if (tool.startsWith('blk-')) blockTool(tool);
  });

  el.steps.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const sec = curSection();
    if (b.dataset.step === 'prev') app.stepBar = (app.stepBar + sec.bars - 1) % sec.bars;
    else if (b.dataset.step === 'next') app.stepBar = (app.stepBar + 1) % sec.bars;
    else {
      const t = curTrack();
      const on = S.toggleStep(app.project, app.project.cur, t, app.focus.r, app.focus.c, +b.dataset.step);
      if (on && !engine.playing && engine.ready) {
        engine.g.playCell(t, app.focus.r, app.focus.c, t.role === 'drums' ? undefined : t.chord, 0.8, engine.now, 0.25);
      }
      if (app.settings.haptics) haptic();
      afterEdit();
      return;
    }
    renderSteps();
  });

  el.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) setView(b.dataset.view);
  });

  bindGrid(); bindFx(); bindMix(); bindSong();

  engine.on((type) => {
    if (type === 'transport') { renderTransport(); renderSections(); if (app.view === 'song') markSongColumn(); mapDirty = true; }
    else if (type === 'edit') { mapDirty = true; updateBadges(); updateHint(); touch(); if (!el.steps.hidden) renderSteps(); el.undo.toggleAttribute('disabled', !S.canUndo()); }
    else if (type === 'section' || type === 'queue') renderSections();
    else if (type === 'songend') toast('That is the whole song!');
  });

  window.addEventListener('resize', () => { mapDirty = true; fitGrid(); });
  if (window.ResizeObserver) new ResizeObserver(fitGrid).observe(el.stage);
  document.addEventListener('visibilitychange', () => {
    // coming back to the app: wake the audio so the first tap is not swallowed
    if (!document.hidden && engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume().catch(() => {});
  });
  onBack(() => {
    if (sheetIsOpen()) { closeSheet(); return true; }
    if (app.view !== 'play') { setView('play'); return true; }
    if (engine.playing) { engine.stop(); return true; }
    saveNow();
    exitApp();
    return true;
  });
  onPause(() => { engine.suspend(); saveNow(); });
}

function blockTool(tool) {
  const p = app.project, i = app.songSel, b = p.song[i];
  if (!b) return;
  if (tool === 'blk-sec') { S.pushUndo(p); b.sec = (b.sec + 1) % p.sections.length; }
  else if (tool === 'blk-rep') { S.pushUndo(p); b.rep = { 1: 2, 2: 4, 4: 8, 8: 1 }[b.rep] || 1; }
  else if (tool === 'blk-left') app.songSel = S.moveBlock(p, i, -1);
  else if (tool === 'blk-right') app.songSel = S.moveBlock(p, i, 1);
  else if (tool === 'blk-copy') { S.addBlock(p, i + 1, i); app.songSel = i + 1; }
  else if (tool === 'blk-del') { S.removeBlock(p, i); app.songSel = Math.min(i, p.song.length - 1); }
  engine.songFrom = Math.max(0, app.songSel);
  renderSong(); renderTools(); renderSections(); renderTransport(); touch();
}

// After undo/redo or anything that may have changed tracks and sections.
export function afterStructureChange(resync = true) {
  const p = app.project;
  if (!p.tracks.some((t) => t.id === app.trackId)) app.trackId = p.tracks[0].id;
  if (resync) {
    engine.syncAll();
    if (engine.g) for (const id of [...engine.g.channels.keys()]) if (!p.tracks.some((t) => t.id === id)) engine.removeTrack(id);
  }
  app.songSel = Math.min(app.songSel, p.song.length - 1);
  renderAll();
  touch();
}

// ---------- boot ----------

async function boot() {
  mountIcons();
  $('logo-bubbles').innerHTML = [0, 1, 2, 3, 4].map((i) => `<div class="bub hue-${i}" style="--bob:${2.600 + i * 0.4}s;--delay:${-i * 0.7}s"><div class="orb"><div class="face">${FACE}</div></div></div>`).join('');
  app.project = S.loadLast() || S.newProject();
  app.trackId = (app.project.tracks.find((t) => t.role === 'melody') || app.project.tracks[0]).id;
  engine.tapOffset = (app.settings.tapOffset || 0) / 1000;
  engine.metroPlay = !!app.settings.metroPlay;
  engine.smooth = app.settings.smooth || 'auto';
  engine.project = app.project;
  bind();
  el.app.hidden = false;
  renderAll();
  fitGrid();
  requestAnimationFrame(frame);

  const start = async () => {
    el.splash.classList.add('gone');
    try { await engine.wake(app.project); } catch (e) { toast('Audio could not start: ' + e.message, 4000); }
    renderAll();
  };
  $('btn-start').onclick = start;
  el.splash.addEventListener('pointerdown', (e) => { if (e.target === el.splash) start(); });
  window.bubbloop = app;       // handy for tests and tinkering
}

boot();
