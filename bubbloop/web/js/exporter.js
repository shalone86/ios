// Export: render the note data to audio, master it, encode it, save it.

import { renderProject } from './render.js';
import { encodeMidi } from './codec/midi.js';
import { buildPack } from './codec/sfz.js';
import { masterById } from './graph.js';
import { saveFile } from './platform.js';
import { SECTION_NAMES } from './state.js';

export const FORMATS = [
  { id: 'wav',   name: 'WAV',            hint: 'studio quality',          ext: 'wav', mime: 'audio/wav' },
  { id: 'm4a',   name: 'Apple Lossless', hint: 'perfect, half the size',  ext: 'm4a', mime: 'audio/mp4' },
  { id: 'mp3',   name: 'MP3',            hint: 'small, plays anywhere',   ext: 'mp3', mime: 'audio/mpeg' },
  { id: 'stems', name: 'Stems',          hint: 'a WAV per track',         ext: 'wav', mime: 'audio/wav' },
  { id: 'midi',  name: 'MIDI',           hint: 'just the notes',          ext: 'mid', mime: 'audio/midi' },
  { id: 'pack',  name: 'Instrument pack', hint: 'these sounds for your DAW', ext: 'zip', mime: 'application/zip' },
];

let worker = null, jobId = 0;
const jobs = new Map();

function encode(msg, transfer, onProgress) {
  if (!worker) {
    worker = new Worker(new URL('./codec/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = jobs.get(e.data.id);
      if (!job) return;
      if (e.data.progress != null) { if (job.onProgress) job.onProgress(e.data.progress); return; }
      jobs.delete(e.data.id);
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve({ bytes: new Uint8Array(e.data.bytes), info: e.data.info });
    };
    worker.onerror = (e) => {
      for (const job of jobs.values()) job.reject(new Error(e.message || 'Encoder failed'));
      jobs.clear();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    jobs.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, ...msg }, transfer);
  });
}

const safe = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Boba Beats';

// options: { format, what: 'song'|'loop', master, bits, kbps, seamless }
// onStatus(label, fraction) is called as work moves along.
// Resolves to { files: [{ name, where, uri, mime }], info }.
export async function exportProject(project, options, onStatus = () => {}) {
  const fmt = FORMATS.find((f) => f.id === options.format) || FORMATS[0];
  const what = options.what === 'song' && project.song.length ? 'song' : 'loop';
  const base = safe(project.name) + (what === 'loop' ? ` (loop ${SECTION_NAMES[project.cur]})` : '');
  const files = [];

  if (fmt.id === 'midi') {
    onStatus('Writing notes', 0.5);
    const name = `${base}.mid`;
    files.push({ name, ...(await saveFile(name, fmt.mime, encodeMidi(project, what))) });
    return { files, info: null };
  }

  if (fmt.id === 'pack') {
    const pack = await buildPack(project, onStatus);
    onStatus('Saving', 0.98);
    const name = `${safe(project.name)} instruments.zip`;
    files.push({ name, ...(await saveFile(name, fmt.mime, pack.bytes)) });
    return { files, info: null };
  }

  const preset = masterById(options.master || project.master);
  const withMaster = { ...project, master: preset.id };
  const seamless = what === 'loop' && !!options.seamless;
  const common = { what, passes: 1, seamless, sampleRate: 44100 };

  if (fmt.id === 'stems') {
    const tracks = project.tracks;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const frac = (v) => (i + v) / tracks.length;
      onStatus(`Bouncing ${t.name}`, frac(0));
      const r = await renderProject(project, { ...common, solo: t.id, master: false, onProgress: (v) => onStatus(`Bouncing ${t.name}`, frac(v * 0.7)) });
      const out = await encode({ format: 'wav', channels: r.channels, sampleRate: r.sampleRate, bits: options.bits || 24, target: null },
        r.channels.map((c) => c.buffer));
      const name = `${base} - ${String(i + 1).padStart(2, '0')} ${safe(t.name)}.wav`;
      files.push({ name, ...(await saveFile(name, 'audio/wav', out.bytes)) });
    }
    return { files, info: null };
  }

  onStatus('Rendering', 0);
  const r = await renderProject(withMaster, { ...common, onProgress: (v) => onStatus('Rendering', v * 0.55) });
  onStatus(preset.lufs == null ? 'Encoding' : 'Mastering', 0.56);
  const out = await encode({
    format: fmt.id, channels: r.channels, sampleRate: r.sampleRate,
    bits: options.bits || 16, kbps: options.kbps || 256, title: project.name,
    // a seamless loop is left un-normalised so its two ends still meet
    target: seamless ? null : preset.lufs,
  }, r.channels.map((c) => c.buffer), (v) => onStatus('Encoding', 0.6 + v * 0.3));
  onStatus('Saving', 0.92);
  const name = `${base}.${fmt.ext}`;
  files.push({ name, ...(await saveFile(name, fmt.mime, out.bytes, (v) => onStatus('Saving', 0.92 + v * 0.08))) });
  return { files, info: out.info, seconds: r.seconds };
}
