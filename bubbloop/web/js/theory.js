// Music theory helpers: pentatonic scales, grid -> pitch mapping, chords.

export const PPQ = 96;            // ticks per quarter note
export const STEP = PPQ / 4;      // one 16th note
export const BAR = PPQ * 4;       // 4/4 only
export const ROWS = 5;
export const COLS = 5;

export const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Each five-note scale carries a seven-note "parent" used to build chords,
// so a chord on any bubble always belongs to the same key as the melody.
export const SCALES = [
  { id: 'major', name: 'Major',     mood: 'sunny',    steps: [0, 2, 4, 7, 9],  parent: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor',     mood: 'moody',    steps: [0, 3, 5, 7, 10], parent: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'egypt', name: 'Egyptian',  mood: 'desert',   steps: [0, 2, 5, 7, 10], parent: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'yo',    name: 'Yo',        mood: 'festival', steps: [0, 2, 5, 7, 9],  parent: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'hira',  name: 'Hirajoshi', mood: 'sakura',   steps: [0, 2, 3, 7, 8],  parent: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'kumoi', name: 'Kumoi',     mood: 'misty',    steps: [0, 2, 3, 7, 9],  parent: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'insen', name: 'In Sen',    mood: 'mystic',   steps: [0, 1, 5, 7, 10], parent: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'pelog', name: 'Pelog',     mood: 'gamelan',  steps: [0, 1, 3, 7, 8],  parent: [0, 1, 3, 5, 7, 8, 10] },
];

export const CHORDS = [
  { id: 'off',    name: 'Single', hint: 'one note' },
  { id: 'triad',  name: 'Triad',  hint: 'three-note chord' },
  { id: 'seven',  name: '7th',    hint: 'jazzy four notes' },
  { id: 'maj7',   name: 'Maj7',   hint: 'always a major seventh' },
  { id: 'min7',   name: 'Min7',   hint: 'always a minor seventh' },
  { id: 'dom7',   name: 'Dom7',   hint: 'always a dominant seventh' },
  { id: 'nine',   name: '9th',    hint: 'lush five notes' },
  { id: 'eleven', name: '11th',   hint: 'airy and suspended' },
  { id: 'thirteen', name: '13th', hint: 'big band colour' },
  { id: 'dream',  name: 'Dreamy', hint: 'wide open voicing' },
  { id: 'power',  name: 'Power',  hint: 'root + fifth' },
  { id: 'stack',  name: 'Stack',  hint: 'pentatonic cluster' },
];

const FIXED = { maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10] };

// Lowest note of the bottom row, per role. The root is placed at the first
// pitch of the key at or above this MIDI note.
const ROLE_FLOOR = { bass: 28, pads: 41, melody: 45, drums: 36 };

export function scaleById(id) {
  return SCALES.find((s) => s.id === id) || SCALES[0];
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiName(m) {
  return KEY_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export function rootMidi(project, track) {
  const floor = ROLE_FLOOR[track.role] ?? 45;
  let m = floor + ((project.key - floor) % 12 + 12) % 12;
  return m + 12 * (track.oct || 0);
}

// MIDI note(s) for a bubble. chord = one of CHORDS ids.
// acc: +1 sharpens, -1 flattens (an accidental outside the scale).
export function cellNotes(project, track, row, col, chord = 'off', acc = 0) {
  const sc = scaleById(project.scale);
  const base = rootMidi(project, track) + 12 * row + (acc || 0);
  const root = base + sc.steps[col];
  if (!chord || chord === 'off') return [root];

  if (chord === 'stack') {
    // every other pentatonic tone: always in scale, floaty
    return [0, 2, 4].map((k) => {
      const i = col + k;
      return base + sc.steps[i % 5] + 12 * Math.floor(i / 5);
    });
  }
  // fixed shapes: the same quality on any bubble, even if it steps outside the key
  const fixed = FIXED[chord];
  if (fixed) return fixed.map((semi) => root + semi);
  const pi = sc.parent.indexOf(sc.steps[col]);
  const deg = (k) => {
    const i = pi + k;
    return base + sc.parent[((i % 7) + 7) % 7] + 12 * Math.floor(i / 7);
  };
  switch (chord) {
    case 'triad': return [deg(0), deg(2), deg(4)];
    case 'seven': return [deg(0), deg(2), deg(4), deg(6)];
    case 'nine': return [deg(0), deg(2), deg(4), deg(6), deg(8)];
    case 'eleven': return [deg(0), deg(4), deg(6), deg(8), deg(10)];
    case 'thirteen': return [deg(0), deg(2), deg(6), deg(8), deg(12)];
    case 'dream': return [deg(0), deg(4), deg(8), deg(9)];
    case 'power': return [deg(0), deg(4), deg(7)];
    default: return [root];
  }
}

// Short label for a chord bubble, e.g. "Am", "G", "Bdim".
export function chordLabel(project, col, chord) {
  const sc = scaleById(project.scale);
  const rootPc = (project.key + sc.steps[col]) % 12;
  const name = KEY_NAMES[rootPc];
  if (chord === 'power') return name + '5';
  if (FIXED[chord]) return name + { maj7: 'maj7', min7: 'm7', dom7: '7' }[chord];
  if (chord === 'stack') return name + '△';
  const pi = sc.parent.indexOf(sc.steps[col]);
  const iv = (k) => {
    const i = pi + k;
    return sc.parent[i % 7] + 12 * Math.floor(i / 7) - sc.parent[pi];
  };
  const third = iv(2), fifth = iv(4), sev = iv(6);
  let q = third === 4 ? '' : 'm';
  if (fifth === 6) q = 'dim';
  if (fifth === 8 && third === 4) q = 'aug';
  if (chord === 'seven') {
    if (q === 'dim') q = sev === 10 ? 'm7♭5' : 'dim7';
    else q += sev === 11 ? (q === '' ? 'maj7' : 'M7') : '7';
  } else if (chord === 'nine' || chord === 'eleven' || chord === 'thirteen') {
    const n = { nine: '9', eleven: '11', thirteen: '13' }[chord];
    if (q === 'dim') q = 'm' + n + '♭5';
    else q += (sev === 11 ? (q === '' ? 'maj' : 'M') : '') + n;
  } else if (chord === 'dream') {
    q += 'add9';
  }
  return name + q;
}

export function quantizeTick(t, grid, strength = 1) {
  if (!grid) return Math.round(t);
  const q = Math.round(t / grid) * grid;
  return Math.round(t + (q - t) * strength);
}
