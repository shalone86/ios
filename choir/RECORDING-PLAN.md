# Choir: what to record

One recording session feeds everything: the Angel Choir and Cantor games, and a
DecentSampler choir for Logic covering three styles:

- **Liturgy**: hymns, Mass parts, chant with a held drone (ison)
- **Cinema**: big soft pads, sharp hits, whispers and swells
- **Gospel**: warm vibrato, scoops and falls, shouts and claps

Record it in tiers. **Tier 1 alone** is enough for both games and a usable
instrument; each later tier makes the instrument richer.

## Voices and notes

| Part | Range to cover | Notes to sing (every 3 semitones) |
|---|---|---|
| Soprano | C4 – A5 | C4 Eb4 F#4 A4 C5 Eb5 F#5 A5 |
| Alto | F3 – D5 | F3 Ab3 B3 D4 F4 Ab4 B4 D5 |
| Tenor | C3 – A4 | C3 Eb3 F#3 A3 C4 Eb4 F#4 A4 |
| Bass | E2 – C4 | E2 G2 Bb2 C#3 E3 G3 Bb3 C4 |

The sampler fills the notes in between (each recording stretches 1 semitone up
and down). Skip any note that's a strain: a thin top note sounds worse than a
gap. If you sing a part outside your own voice, say which; formant shifting
(already in Boba Beats) can move a voice part a little, but sopranos and altos
sound real only from real high voices, kids included.

**For a choir rather than a soloist**, sing each part's Tier 1 sustains
**four times** (four separate takes). Stacked, they become a section. Tier 2
and later can be sung once.

## Tier 1: the core (games + a first instrument)

Per part, on every note above:

1. **Sustains**: *Ah, Oh, Oo, Mm (hum)*, 8 seconds each, steady, little or no
   vibrato, **mp** and **f**. Start cleanly and let the end fade naturally.
2. **Shorts**: *Ah* and *Da*, about half a second, **f**, sung **3 times
   each** (the sampler takes turns so repeats never sound identical).

Plus, once per part at a comfortable middle note:

3. **Words for the games**: *Amen* (two notes, falling a step), *Alleluia*,
   *Gloria*, short and joyful, 3 takes each.

That's about 8 notes × (8 sustains + 6 shorts) ≈ 110 clips per part, or around
45 minutes per part with breaks.

## Tier 2: liturgy and chant

- **Ee** and **Eh** sustains (mp, f): finishes the vowel set for Latin and
  Greek texts (*Kyrie eleison*, *Sanctus*, *Agnus Dei*).
- **Drone / ison**: bass and tenor, *Ah*, *Oh* and *Mm*, **20 seconds** each on
  C, D, E, F, G and A, very steady (these loop for chant beds and Deep Drift).
- **Word-builder consonants**: these let the sampler "sing" any word by
  adding a consonant at the start or end of a vowel. Starts: *K, T, S, D, Gl, Al, M, N, L*
  (each sung straight into *Ah*, middle note, 3 takes). Endings: *-s, -t, -n,
  -m*, plus breath.
- **Whole phrases** on one note per part: *Kyrie eleison*, *Christe eleison*,
  *Agnus Dei*, *Sanctus*, *Lord, have mercy*.

## Tier 3: cinema

- **Swells**: *Ah* and *Oo*, from nothing to **ff** over 4 seconds, then held.
- **Marcato hits**: *Ah!* and *Hah!* with a hard accent, **ff**, 3 takes.
- **Staccato syllables**: *Ta, Ka, Da, Pa*, very short, 3 takes each (the
  driving pattern sound of film trailers).
- **Whispers and breath**: whispered *Ah*, *Sss*, *Shh*, a slow inhale and
  exhale (unpitched, record each a few times).
- **Clusters and falls**: a held note that slides down a semitone slowly;
  a "shimmer" with a quick, light trill.

## Tier 4: gospel

- **Vibrato sustains**: *Oh* and *Ah*, **f**, with full natural vibrato.
- **Scoops and falls**: start a step below and slide up into the note; sing
  the note and fall off the end. Each on 3 notes per part.
- **Shouts and ad-libs**, at a middle note and as spoken shouts: *Yeah!*,
  *Hey!*, *Oh!*, *Whoa*, *Hallelujah!*, *Come on!*, *Amen!*, 3 takes each.
  (These are the sounds for the shout-choir game later.)
- **Body percussion**: claps (one, then a group of overdubbed claps), foot
  stomps, finger snaps, 4 takes each.

## How to record

**The easy way: Voice Booth** (shalonely.com/record). Pick a batch under
*Choir session* (each part is three batches: Ah and Oh, Oo and Mm, shorts and
words). Each line plays its note, then records while you sing it four times
(three for shorts), showing whether you're in tune. Save the zip, send it to
Claude, then clear the batch to free up the phone. A good USB mic into a
computer's browser works too, and sounds better than a phone.

**Or in Logic**, following the same lines:

- **48 kHz, 24-bit WAV**, one file per take. Mono is fine.
- **A dry, quiet room**: a closet full of clothes is better than a nice-sounding
  hall. The reverb gets added later; it can't be taken out.
- Same mic, same distance (about a hand-span and a half), same gain the whole
  session. Write the gain down so a later session can match it.
- Play a quiet reference note in headphones before each sustain; nothing from
  the headphones should reach the mic.
- Leave **a second of silence** before and after every take. Keep going after
  mistakes; just sing it again.
- Say a slate at the start of each run ("Alto, Ah, mezzo-piano, from F3 up").
  Long continuous recordings are fine: the chopping tool will split, trim,
  tune-check and name every clip from the slate and your notes.

## What I'll build from it

- A **chopping tool** that splits the long recordings into named clips, trims
  silence, checks pitch, picks loop points for the sustains, and normalises
  levels per part.
- The **DecentSampler choir**: one instrument with keyswitches for each
  articulation (sustain vowels, shorts, swells, words, gospel); the mod wheel
  fades between mp and f; separate SATB parts or full choir; reverb, and a
  "section" knob that stacks the four takes.
- **Game sound packs**: smaller, compressed sets for Angel Choir, Cantor and
  Deep Drift.
