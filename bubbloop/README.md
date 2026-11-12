# Bubbloop

Pocket beats made of bubbles. A loop-based beat maker for Android where every
instrument is played on the same grid of 25 singing bubbles, tuned to a
five-note scale so nothing you tap can sound wrong.

Tap a loop in, add an instrument, add another, mute and unmute, chain the
loops into a song, and export a mastered WAV, MP3 or Apple Lossless file.
Nothing is committed to audio until you export, so a sketch can be tweaked
as many times as you like, or taken into a DAW as MIDI and stems.

## Install on your phone

A ready-built APK is in [`dist/Bubbloop.apk`](dist/Bubbloop.apk).

1. Open that file on your Android phone (download it from GitHub, or send it
   to yourself).
2. Android will ask whether to allow installing from this source. Allow it.
3. Open **Bubbloop**.

It needs Android 7 or newer, asks for no permissions and never uses the
network. Exports are saved to `Music/Bubbloop` on the phone.

## How it works

**The grid.** Five bubbles across are the five notes of the scale; each row
up is an octave higher (and a slightly smaller bubble). The key and scale
apply to every track, and notes are stored as grid positions, so changing key
or scale later moves the whole song with it.

**Tracks.** Drums, Bass, Pads and Melody to start with, up to eight. Tap a
mascot to play that track on the grid; tap **on / zzz** under it to mute.
Long-press a mascot to rename, re-voice or remove the track.

| Instruments | |
| --- | --- |
| Keys | E-Piano, Piano, Organ, Music Box, Kalimba |
| Synths | Synth, Dream Pad, Chiptune |
| Bass | Bass Guitar, Bass Synth |
| Ensemble | Choir, Strings, Horns |
| Drums | 25 finger-drumming pads: 2 kicks, 3 snares, 3 closed hats, open hat, clap, 5 toms, ride, crash, 2 shakers, tambourine, rain drum, rim, cowbell, pop, sparkle |

**Chords.** On any melodic track, switch **Chords** to Triad, 7th, Dreamy,
Power or Stack and each bubble plays a whole chord built from the song's key.

**Looping.** Press the pink button: after a one-bar count-in, whatever you
play is recorded into the loop and keeps going round. Switch track and keep
adding. Notes snap to 16ths by default (change it under the tempo button).
**Undo** takes back one pass at a time. **Steps** opens a 16-step editor for
the last bubble you touched; **Erase** wipes a bubble's notes with a tap.

**Grooves.** On the drum track, **Grooves** drops in one of 14 preset
patterns to play over or edit.

**Sections.** A, B, C… are different loops in the same song. Tap one while
playing and it takes over at the next bar line. Long-press to copy or clear.

**FX.** Eight hold-to-play effects, on the whole mix or one track, on the FX tab: Cloud (reverb), Echo
(delay), Squish (compressor), Crunch (distortion), Stutter, Glitch, Dive
(filter) and Sleepy (tape stop). Slide across Stutter and Dive to change
their setting. Hold one while recording to keep the move in the loop; tap the
lock to leave one switched on.

**Song mode.** The Song tab is a matrix: each column is a block of the song
(which section, how many times), each row a track. Tap a bubble to rest or
wake that track for that block. Play runs the song from the selected block.

**Export.** WAV, Apple Lossless (.m4a), MP3, MIDI, or stems (one WAV per
track). Mastering presets set the tone and bring the song to a streaming
loudness target (EBU R128) with a look-ahead peak limiter. A loop can be
exported seamless, ready to drop into a DAW.

## Layout

```
bubbloop/
  web/        the whole app: plain HTML, CSS and ES modules, no build step
    js/         theory, instruments, drums, graph (FX + mastering), engine,
                seq, render, state, exporter, platform
    js/codec/   WAV, Apple Lossless, MIDI writers; mastering; export worker
    js/ui/      the interface
    vendor/     lamejs (MP3 encoder, LGPL)
  android/    a thin Java shell: one WebView that serves web/ and saves files
  tests/      sound, codec and end-to-end tests
  dist/       the built APK
```

## Run it in a browser

The app is a static site. Any web server will do:

```sh
cd bubbloop/web && python3 -m http.server 8000
# open http://localhost:8000 (Chrome works best; use the phone toolbar)
```

## Build the APK

Needs JDK 17+ and the Android SDK (platform 35, build-tools 35.0.0).

```sh
cd bubbloop/android
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

The build is signed with `android/app/sideload.jks`, a key kept in the repo
(password `bubbloop`) so that every build installs over the last one. It is
for sideloading only. To publish on a store, sign with a private key of your
own.

Pushing to GitHub also builds the APK: see the **Bubbloop APK** workflow
under Actions, which attaches it to each run.

## Tests

Needs Node 20+, ffmpeg, and Playwright with Chromium.

```sh
node bubbloop/tests/codec.test.mjs    # encoders, checked against ffmpeg
node bubbloop/tests/sounds.test.mjs   # every instrument and drum pad
node bubbloop/tests/app.test.mjs      # the app end to end, at phone size
```

`codec.test.mjs` decodes every exported format with ffmpeg: WAV and Apple
Lossless must come back bit-for-bit, and the loudness meter must agree with
ffmpeg's EBU R128 reading.

## Credits

- Type: [Fredoka](https://github.com/hafontia/Fredoka-One), SIL Open Font License.
- MP3 encoding: [lamejs](https://github.com/shijinyu/lamejs), LGPL.
- All sounds are synthesised in the app; there are no samples.
