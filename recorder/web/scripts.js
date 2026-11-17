// The scripts the booth can record. Each line's `file` is the name Claude's
// tools look for (tools/tutorial-voice/own/<file>.wav for the tutorials).
window.SCRIPTS = {
  'deep-drift': {
    title: 'Deep Drift tutorial',
    tip: 'Slow and soft, like a bedtime voice.',
    lines: [
      ['intro', 'This is Deep Drift. A dark, quiet sea that sings you to sleep.', 'the sea appears'],
      ['tap', 'Tap a sleepy jellyfish. Its note drifts away, and comes back, again and again.', 'one jellyfish is tapped'],
      ['weave', 'Each one has its own loop, so the notes slowly weave together.', 'two more are tapped'],
      ['rest', 'Tap a glowing one again to let it rest.', 'a glowing one is tapped again'],
      ['hold', 'Hold one to hum its note, for as long as you like.', 'a jellyfish is held'],
      ['voices', 'Pick a voice. Pad, Glass, Choir, or Low. Notes you played before keep their own sound.', 'Glass, then Choir'],
      ['depth', 'Depth sinks everything lower, darker, and farther away.', 'the Depth slider moves'],
      ['tide', 'Tide sets how often the notes come back.', 'the Tide slider moves'],
      ['tape', 'Tape adds the wobble, warmth, and hiss of an old cassette.', 'the Tape slider moves'],
      ['animate', 'Or press Animate, and the tide moves on its own.', 'Animate turns on'],
      ['hum', 'Hum adds a low drone underneath.', 'Hum turns on'],
      ['mood', 'Change the mood up here. Every note still fits.', 'the mood changes'],
      ['sleep', 'Set the sleep timer, and the sea fades away when it\'s time.', 'the sleep timer is set'],
      ['bye', 'Tap a few lights, then close your eyes. Goodnight.', 'the goodnight screen'],
    ],
  },
  'pop-pads': {
    title: 'Pop Pads tutorial',
    tip: 'Bright and bubbly.',
    lines: [
      ['intro', 'This is Pop Pads. A fizzy little drum machine.', 'the app opens'],
      ['tap', 'Tap a bubble to play a drum. Kicks and snares are on the bottom row, hats and percussion above.', 'pads are tapped'],
      ['hold', 'Hold a bubble, and it repeats in time.', 'a pad is held'],
      ['stutter', 'Keep holding, and slide up to stutter the beat. Slide further for a tighter stutter.', 'the finger slides up'],
      ['jumble', 'Slide down to jumble it up. Let go, and it snaps back.', 'the finger slides down, then lets go'],
      ['flavor', 'Each flavor is a different drum kit. Your beat stays, and the sounds change.', 'the flavour menu'],
      ['record', 'Press record. You\'ll hear four clicks, then play along. Everything you tap snaps to the beat.', 'recording with the count-in'],
      ['metro', 'Turn on the metronome to help keep time.', 'the metronome button'],
      ['steps', 'In Steps, pick a drum, and tap the steps where it plays.', 'steps mode'],
      ['shape', 'These sliders change that drum\'s pitch, length, tone, and volume.', 'the drum\'s sliders'],
      ['locks', 'Hold a step, and that one hit gets its own settings. Even nudge it a little early or late.', 'a step is held and its sliders move'],
      ['patterns', 'There are eight patterns. Hold a number to copy your beat into it.', 'a pattern is copied'],
      ['chain', 'Tap chain, then tap patterns in order to play them one after another.', 'a chain is made'],
      ['knobs', 'Filter, drive, crush, and swing shape the whole beat. The LFO moves the sound in time.', 'the knobs move'],
      ['motion', 'While recording, hold and move any knob, and the move plays back every loop.', 'a knob sweeps while recording'],
      ['save', 'When you\'re happy, save it. A loop, the pattern for Logic, or every drum on its own.', 'the save menu'],
      ['bye', 'Now make it pop!', 'the end screen'],
    ],
  },
  'boba-beats': {
    title: 'Boba Beats tutorial',
    tip: 'Bright and friendly.',
    lines: [
      ['intro', 'Hi! This is Boba Beats. Let\'s make a song out of bubbles.', 'the app opens'],
      ['tune', 'Every bubble is in tune, so tap around. Nothing can sound wrong.', 'bubbles are tapped'],
      ['key', 'Pick a key and a scale. Every track follows it.', 'the key menu'],
      ['drums', 'Start with drums. Pick a groove, or tap your own.', 'a groove is chosen'],
      ['pads', 'The drums are twenty five pads: kicks, snares, hats, and more.', 'drum pads are tapped'],
      ['bass', 'Now the bass. Press the pink button. After a one bar count in, it records what you play.', 'bass is recorded'],
      ['loop', 'It keeps looping, and your notes snap to the beat.', 'the loop plays'],
      ['chords', 'Chords next. One bubble plays a whole chord.', 'chords are recorded'],
      ['melody', 'Add a melody on top. Wiggle a held bubble to bend the note.', 'a melody is recorded'],
      ['mute', 'Tap zzz to rest a track. Tap it again to wake it up.', 'drums rest and wake'],
      ['fx', 'Hold an effect pad. Slide across it to change the sound.', 'FX pads are held'],
      ['section', 'Make a second section. B starts as a copy of A, so just change what you like.', 'section B is made'],
      ['song', 'Song mode lines your loops up into a whole song.', 'song mode opens'],
      ['rest', 'Tap a bubble to rest a track in that part. Hold one for a fill.', 'a fill is added'],
      ['play', 'Press play to hear it all.', 'the song plays'],
      ['mix', 'The mixer sets each track\'s volume, cloud, and echo.', 'the mixer'],
      ['export', 'When you\'re happy, export a loud, mastered file.', 'the export menu'],
      ['more', 'There\'s more in the menus, like a sampler for your own sounds.', 'the song menu'],
      ['bye', 'Now make your own song. Have fun!', 'the end screen'],
    ],
  },
};

// ---------- the choir session (Tier 1 of choir/RECORDING-PLAN.md) ----------
// Each voice part is three batches. A line is one vowel on one note, sung
// several times in a row; the chopping tool splits the takes apart later.
// Lines carry a MIDI note: the booth plays it before you sing and shows
// your pitch while you do.
(function () {
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const name = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  const fileNote = (m) => name(m).replace('#', 's');
  const PARTS = {
    soprano: { title: 'Soprano', notes: [60, 63, 66, 69, 72, 75, 78, 81] },
    alto: { title: 'Alto', notes: [53, 56, 59, 62, 65, 68, 71, 74] },
    tenor: { title: 'Tenor', notes: [48, 51, 54, 57, 60, 63, 66, 69] },
    bass: { title: 'Bass', notes: [40, 43, 46, 49, 52, 55, 58, 60] },
  };
  const DYN = { mp: 'soft (mp)', f: 'strong (f)' };
  const SUSTAIN = 'Sing it 4 times, 4 to 8 seconds each, with a breath between. Steady, little vibrato: stop early rather than drift. Skip any note that strains.';
  const sustains = (id, part, vowels) => {
    const lines = [];
    for (const v of vowels) for (const d of ['mp', 'f']) for (const m of part.notes) {
      lines.push([`${id}_${v.toLowerCase()}_${d}_${fileNote(m)}`, `${v} · ${DYN[d]} · ${name(m)}`, SUSTAIN, m]);
    }
    return lines;
  };
  for (const [id, part] of Object.entries(PARTS)) {
    const mid = part.notes[3];
    window.SCRIPTS[`choir-${id}-1`] = { title: `Choir · ${part.title} 1: Ah and Oh`, group: 'Choir', tip: '', lines: sustains(id, part, ['Ah', 'Oh']) };
    window.SCRIPTS[`choir-${id}-2`] = { title: `Choir · ${part.title} 2: Oo and Mm`, group: 'Choir', tip: '', lines: sustains(id, part, ['Oo', 'Mm']) };
    const shorts = [];
    for (const s of ['Ah', 'Da']) for (const m of part.notes) {
      shorts.push([`${id}_short-${s.toLowerCase()}_${fileNote(m)}`, `Short "${s}!" · strong · ${name(m)}`, 'Sing it 3 times: short and strong, about half a second each, with a little gap between.', m]);
    }
    for (const w of ['Amen', 'Alleluia', 'Gloria']) {
      shorts.push([`${id}_${w.toLowerCase()}_${fileNote(mid)}`, `"${w}" · starting on ${name(mid)}`, `Sing it 3 times, short and joyful${w === 'Amen' ? ' (two notes, falling a step)' : ''}, with a breath between.`, mid]);
    }
    window.SCRIPTS[`choir-${id}-3`] = { title: `Choir · ${part.title} 3: shorts and words`, group: 'Choir', tip: '', lines: shorts };
  }
  window.noteName = name;
})();

// ---------- Angelio: the letter sounds for Letter Lane and Read Aloud ----------
// The same list as angelio.org/admin/sounds (built from the apps' word lists,
// 2026-11-16). Each file is named after the sound, as the apps store it.
(function () {
  const GROUPS = [["Letters",[["sss","s (sun, bus)"],["ah","a (apple, cat)"],["tuh","t (tiger, cat)"],["puh","p (pig, map)"],["ih","i (iguana, pig)"],["nnn","n (nose, sun) · kn (knot, knife)"],["mmm","m (moon, map) · mb (lamb, thumb)"],["duh","d (dog, bed)"],["guh","g (goat, pig)"],["aw","o (octopus, dog) · a (watch)"],["kuh","c (cat, cup) · k (kite, king) · ck (chick, duck)"],["eh","e (egg, hen)"],["uh","u (umbrella, sun)"],["rrr","r (rabbit, ran) · wr (write, wrench)"],["huh","h (hat, hen)"],["buh","b (bus, bed)"],["fff","f (fish, fin)"],["lll","l (lion, log) · ll (shell)"],["ay","a (cake, snake) · ai (rain, snail) · ay (day, play)"],["eye","i (kite, five) · igh (night, light)"],["oh","o (bone, rose) · oa (boat, goat) · ow (snow, bow)"],["z","s (rose)"],["yoo","u (cube, cute)"],["oo","u (tube)"]]],["Kindergarten chunks",[["shh","sh (ship, shell)"],["chuh","ch (chick, chip) · tch (watch, catch)"],["thuh","th (bath, thin)"],["wuh","w (with, wing)"]]],["1st grade chunks",[["ing","ing (ring, king)"],["unk","unk (skunk, junk)"],["juh","j (junk, jump) · dge (bridge, badge)"],["fruh","fr (frog)"],["fluh","fl (flag)"],["druh","dr (drum)"],["kruh","cr (crab)"],["sluh","sl (sled)"],["nnd","nd (hand, bend)"],["fft","ft (gift)"],["llk","lk (milk)"],["nnt","nt (tent)"],["stuh","st (stop)"],["snuh","sn (snap)"],["truh","tr (trip)"],["gruh","gr (grin)"],["kluh","cl (clap)"],["pluh","pl (plan)"],["mmp","mp (jump, lamp)"],["sst","st (fast)"],["vvv","v (five)"]]],["2nd grade chunks",[["ee","ee (bee, tree) · ea (leaf, peach)"],["ar","ar (car, star)"],["or","or (corn, fork)"],["er","ir (bird, girl) · ur (purse, turn) · er (her, fern)"],["oy","oi (coin, soil) · oy (boy, toy)"],["ow","ou (cloud, house) · ow (cow, owl)"]]],["3rd grade chunks",[["ong","ong (wrong)"]]]];
  const lines = [];
  for (const [group, items] of GROUPS) for (const [sound, uses] of items) {
    lines.push([sound, `"${sound}"   as in ${uses.replace(/ · /g, ', ')}`, `${group}. Say just the sound, once, short and clear. For t, p, k and the like, a quick sound with only a whisper of air, not "tuh-uh".`]);
  }
  for (const [id, who] of [['f', 'Mom'], ['m', 'Dad']]) {
    window.SCRIPTS['angelio-sounds-' + id] = { title: 'Angelio · letter sounds (' + who + "'s voice)", group: 'Angelio', sounds: true, tip: '', lines };
  }
})();

// lines added after a script was first recorded: shown with a NEW badge
window.NEW_LINES = { 'pop-pads': ['locks', 'motion'] };
