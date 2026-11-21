# Bubble apps roadmap

The bubble music apps on shalonely.com: Boba Beats (`/boba`), Pop Pads (`/pop`),
Deep Drift (`/drift`), and next, a chord app in the spirit of an Omnichord.

## Next

- **Chord app** (Omnichord-style): chord bubbles in a key, a strum strip,
  exports and Boba hand-over like Pop Pads. Scope agreed before building.
- **Choir app**: later, as the play mechanics for the Angelio choir game.

## On the roadmap: playing the apps inside Logic

Goal: Pop Pads (then the chord app, then Boba) in a Logic session, played from
Logic's MIDI with our own sound engine, next to Logic's pianos and horns.

### Step 1: MIDI to and from Logic (small, no install)

- Chrome or Edge on a Mac support Web MIDI (Safari does not).
- MIDI out: pads tapped in the app go to Logic over the Mac's IAC Driver bus,
  so Logic records them as MIDI (drums on the GM notes, the bass, chord and
  lead on their own channels, as the MIDI export already does).
- MIDI in: Logic's piano roll plays the app's sounds. Getting that audio back
  into Logic needs a loopback driver (BlackHole, free), so this half is clunky.
- Boba Beats already has Web MIDI input (`bubbloop/web/js/midi.js`) to build on.

### Step 2: real plugins (large)

- Logic loads **Audio Units** only (not VST3). An AUv3 also runs in GarageBand
  and Logic on iPad.
- The sound engines must run natively, outside a browser. They are small and
  all synthesized: Pop Pads' kits are recipes rendered to buffers once, so a
  C++ port of `pop/web/js/kits.js` and `engine.js` is the core of the work.
- The look can stay ours: the plugin window can be a web view showing the
  bubble UI, talking to the native engine.
- One codebase for AU, AUv3 and VST3: JUCE (free starter licence up to a
  revenue limit; check terms when starting).
- Needs a Mac with Xcode and an Apple Developer account (99 USD a year) to sign
  and notarize the plugin so Logic will load it.
- Order: Pop Pads first (a 16-pad instrument: GM drum notes in, the tuned pads
  playable chromatically), then the chord app, then Boba Beats (the largest).
