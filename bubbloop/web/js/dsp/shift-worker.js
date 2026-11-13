// Background worker for the sampler's natural (formant-keeping) pitch.
// Each job is one sample and the notes it needs. The analysis is done once
// per sample, then each note is posted back as soon as it is ready.
import { analyse, shift } from './formant.js';

const analyses = new Map();       // key -> analysis, so a later job reuses it

self.onmessage = (e) => {
  const { job, key, data, sr, f0, notes } = e.data;
  try {
    let an = analyses.get(key);
    if (!an) {
      an = analyse(data, sr, f0);
      analyses.set(key, an);
      if (analyses.size > 8) analyses.delete(analyses.keys().next().value);
    }
    for (const n of notes) {
      const out = shift(data, an, n.semis, n.formant);
      self.postMessage({ job, id: n.id, out }, [out.buffer]);
    }
    self.postMessage({ job, done: true });
  } catch (err) {
    self.postMessage({ job, error: String(err && err.message || err) });
  }
};
