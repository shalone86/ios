// Cozy Chords: the keys, the twelve chord bubbles of each key, and how each
// chord is voiced (the chord itself, its bass note, and the strum strip's
// strings). All in MIDI note numbers; middle C is 60.

export const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// chord shapes, in semitones above the root
export const SHAPES = {
  maj: { iv: [0, 4, 7], name: '' },
  min: { iv: [0, 3, 7], name: 'm' },
  dom7: { iv: [0, 4, 7, 10], name: '7' },
  maj7: { iv: [0, 4, 7, 11], name: 'maj7' },
  min7: { iv: [0, 3, 7, 10], name: 'm7' },
  sus2: { iv: [0, 2, 7], name: 'sus2' },
  sus4: { iv: [0, 5, 7], name: 'sus4' },
  add9: { iv: [0, 4, 7, 14], name: 'add9' },
};

// The twelve bubbles: three rows of four. The top row is home (the chords
// most songs use), the middle row more from the key, the bottom row colors
// borrowed from nearby keys. [numeral, semitones above the key, shape]
export const LAYOUTS = {
  major: [
    ['I', 0, 'maj'], ['IV', 5, 'maj'], ['V', 7, 'maj'], ['vi', 9, 'min'],
    ['ii', 2, 'min'], ['iii', 4, 'min'], ['IVmaj7', 5, 'maj7'], ['V7', 7, 'dom7'],
    ['♭VII', 10, 'maj'], ['iv', 5, 'min'], ['II', 2, 'maj'], ['Isus2', 0, 'sus2'],
  ],
  minor: [
    ['i', 0, 'min'], ['♭VI', 8, 'maj'], ['♭III', 3, 'maj'], ['♭VII', 10, 'maj'],
    ['iv', 5, 'min'], ['v', 7, 'min'], ['V7', 7, 'dom7'], ['♭VImaj7', 8, 'maj7'],
    ['IV', 5, 'maj'], ['♭II', 1, 'maj'], ['im7', 0, 'min7'], ['isus4', 0, 'sus4'],
  ],
};

// the twelve chords of a key: { label, numeral, root (pitch class), shape }
export function chordsOf(key, mode) {
  return LAYOUTS[mode].map(([numeral, off, shape]) => {
    const root = (key + off) % 12;
    return { label: KEY_NAMES[root] + SHAPES[shape].name, numeral, root, shape };
  });
}

// the chord itself, voiced close around middle C (root from F3 up)
export function chordNotes(ch) {
  const base = 53 + ((ch.root - 53) % 12 + 12) % 12;
  return SHAPES[ch.shape].iv.map((i) => base + i);
}
// its bass note: the root, from E2 up (low enough to be bass, high enough
// for a phone speaker to play)
export function bassNote(ch, step = 'r') {
  const r = 40 + ((ch.root - 40) % 12 + 12) % 12;
  return step === '5' ? r + 7 : step === '8' ? r + 12 : r;
}
// the strum strip: twelve strings, every chord tone from E3 upwards
export const STRINGS = 12;
export function stringNotes(ch) {
  const pcs = SHAPES[ch.shape].iv.map((i) => (ch.root + i) % 12), out = [];
  for (let m = 52; out.length < STRINGS; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const noteName = (m) => KEY_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
