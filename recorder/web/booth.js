// Voice Booth: shows a script one line at a time, records each line from the
// microphone as plain PCM, keeps the takes on this device (IndexedDB) and
// saves them all as one zip of WAV files named after their lines.

const $ = (id) => document.getElementById(id);
const S = window.SCRIPTS;
let scriptId = Object.keys(S)[0];
let idx = 0;
const takes = {};                     // file -> { rate, pcm: Float32Array }
let ctx, src, tap, recording = null, playing = null;

try { const saved = localStorage.getItem('booth.script'); if (saved && S[saved]) scriptId = saved; } catch (e) { /* fine */ }

// ---------- storing takes on this device ----------
const db = new Promise((resolve) => {
  try {
    const r = indexedDB.open('voice-booth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('takes');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  } catch (e) { resolve(null); }
});
async function store(key, value) {
  const d = await db; if (!d) return;
  try { const tx = d.transaction('takes', 'readwrite'); value ? tx.objectStore('takes').put(value, key) : tx.objectStore('takes').delete(key); } catch (e) { /* not kept */ }
}
async function loadTakes() {
  for (const k of Object.keys(takes)) delete takes[k];
  const d = await db; if (!d) return;
  await new Promise((resolve) => {
    try {
      const req = d.transaction('takes').objectStore('takes').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const [sid, file] = String(c.key).split('/');
        if (sid === scriptId) takes[file] = c.value;
        c.continue();
      };
      req.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

// ---------- the microphone ----------
const WORKLET = `registerProcessor('grab', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;
async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {
    channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  src = ctx.createMediaStreamSource(stream);
  const onChunk = (ch) => {
    let peak = 0;
    for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    meter(peak);
    if (recording) { recording.chunks.push(ch); recording.peak = Math.max(recording.peak, peak); }
  };
  try {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    tap = new AudioWorkletNode(ctx, 'grab');
    tap.port.onmessage = (e) => onChunk(e.data);
  } catch (e) {
    // older browsers
    tap = ctx.createScriptProcessor(2048, 1, 1);
    tap.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
  }
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(tap).connect(mute).connect(ctx.destination);
}
let shown = 0;
function meter(peak) {
  shown = Math.max(peak, shown * 0.9);
  const m = $('meter');
  m.firstElementChild.style.width = Math.min(100, Math.sqrt(shown) * 100) + '%';
  m.classList.toggle('hot', shown > 0.95);
}

// ---------- recording ----------
function startRec() {
  stopPlay();
  recording = { chunks: [], peak: 0, t0: performance.now() };
  $('rec').classList.add('on'); $('rec').textContent = 'Stop';
  $('status').textContent = 'Recording… read the line, then tap Stop';
  tick();
}
function tick() {
  if (!recording) return;
  $('status').textContent = `Recording… ${((performance.now() - recording.t0) / 1000).toFixed(1)} s`;
  setTimeout(tick, 200);
}
function stopRec() {
  const r = recording; recording = null;
  $('rec').classList.remove('on');
  const n = r.chunks.reduce((a, c) => a + c.length, 0);
  if (n < ctx.sampleRate * 0.3) { $('status').textContent = 'That was very short. Try again.'; render(); return; }
  const pcm = new Float32Array(n);
  let o = 0; for (const c of r.chunks) { pcm.set(c, o); o += c.length; }
  const file = line()[0];
  takes[file] = { rate: ctx.sampleRate, pcm, peak: r.peak };
  store(`${scriptId}/${file}`, takes[file]);
  render();
  $('status').textContent = r.peak > 0.98 ? '⚠ A little loud: move back a bit and try again'
    : r.peak < 0.05 ? '⚠ Very quiet: come a little closer and try again' : `✓ Saved (${(n / ctx.sampleRate).toFixed(1)} s). Play it back, or tap Next.`;
}
function play() {
  stopPlay();
  const t = takes[line()[0]]; if (!t) return;
  const b = ctx.createBuffer(1, t.pcm.length, t.rate); b.copyToChannel(t.pcm, 0);
  playing = ctx.createBufferSource(); playing.buffer = b; playing.connect(ctx.destination);
  playing.onended = () => { playing = null; $('play').textContent = '▶ Play'; };
  playing.start(); $('play').textContent = '■ Stop';
}
function stopPlay() { if (playing) { try { playing.stop(); } catch (e) { /* done */ } playing = null; $('play').textContent = '▶ Play'; } }

// ---------- saving: WAV files in a zip ----------
function wav(t) {
  // 24-bit mono PCM
  const n = t.pcm.length, buf = new ArrayBuffer(44 + n * 3), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 3, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, t.rate, true);
  v.setUint32(28, t.rate * 3, true); v.setUint16(32, 3, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, n * 3, true);
  for (let i = 0, o = 44; i < n; i++, o += 3) {
    const s = Math.max(-1, Math.min(1, t.pcm[i])), x = Math.round(s * 8388607) & 0xffffff;
    v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
  }
  return new Uint8Array(buf);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  // a plain "stored" zip: no compression, which WAV barely needs anyway
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of files) {
    const nm = new TextEncoder().encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function exportAll() {
  const files = S[scriptId].lines.filter(([f]) => takes[f]).map(([f]) => ({ name: `${f}.wav`, data: wav(takes[f]) }));
  if (!files.length) return;
  const name = `${scriptId}-voice.zip`, blob = zip(files);
  const asFile = new File([blob], name, { type: 'application/zip' });
  // on a phone, the share sheet can send it straight to the Claude app
  if (navigator.canShare && navigator.canShare({ files: [asFile] })) {
    try { await navigator.share({ files: [asFile], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ---------- screen ----------
const line = () => S[scriptId].lines[idx];
function render() {
  const sc = S[scriptId], [file, text, hint] = line();
  $('num').textContent = `Line ${idx + 1} of ${sc.lines.length}`;
  $('file').textContent = `${file}.wav`;
  $('text').textContent = text;
  $('hint').textContent = `On screen: ${hint}. ${sc.tip}`;
  $('rec').textContent = recording ? 'Stop' : takes[file] ? 'Redo' : 'Record';
  $('play').disabled = !takes[file];
  $('prev').disabled = idx === 0;
  $('next').textContent = idx === sc.lines.length - 1 ? 'Done ✓' : 'Next ›';
  const done = sc.lines.filter(([f]) => takes[f]).length;
  $('export').disabled = !done;
  $('export').textContent = done === sc.lines.length ? `Save all ${done} as a zip` : `Save ${done} of ${sc.lines.length} as a zip`;
  $('list').innerHTML = sc.lines.map(([f, t], i) => `<li data-i="${i}" class="${i === idx ? 'cur' : ''} ${takes[f] ? 'done' : ''}">
    <b>${takes[f] ? '✓' : i + 1}</b><span>${t.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</span><em>${takes[f] ? (takes[f].pcm.length / takes[f].rate).toFixed(1) + ' s' : ''}</em></li>`).join('');
}
function go(i) {
  if (recording) stopRec();
  stopPlay();
  idx = Math.max(0, Math.min(S[scriptId].lines.length - 1, i));
  $('status').textContent = takes[line()[0]] ? 'Already recorded. Play it, or Redo.' : 'Tap Record, read the line, tap Stop.';
  render();
}

$('script').innerHTML = Object.entries(S).map(([id, s]) => `<option value="${id}">${s.title}</option>`).join('');
$('script').value = scriptId;
$('script').onchange = async (e) => {
  scriptId = e.target.value;
  try { localStorage.setItem('booth.script', scriptId); } catch (err) { /* fine */ }
  await loadTakes(); go(0);
};
$('rec').onclick = () => (recording ? stopRec() : startRec());
$('play').onclick = () => (playing ? stopPlay() : play());
$('prev').onclick = () => go(idx - 1);
$('next').onclick = () => {
  if (idx === S[scriptId].lines.length - 1) { if (recording) stopRec(); $('export').scrollIntoView({ behavior: 'smooth' }); return; }
  go(idx + 1);
};
$('list').onclick = (e) => { const li = e.target.closest('li'); if (li) go(+li.dataset.i); };
$('export').onclick = exportAll;
$('allow').onclick = async () => {
  try { await openMic(); $('start').hidden = true; }
  catch (e) { $('mic-err').textContent = 'The microphone could not be opened. Allow it in your browser settings, then try again.'; }
};

(async () => {
  await loadTakes();
  // start at the first line not yet recorded
  const first = S[scriptId].lines.findIndex(([f]) => !takes[f]);
  go(first < 0 ? 0 : first);
})();
window.booth = { takes, get ctx() { return ctx; }, zip, wav };
