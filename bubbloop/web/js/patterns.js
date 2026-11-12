// Preset drum grooves. One character per 16th note:
//   X = accent, x = normal hit, o = ghost note, . = rest
// Rows are keyed by drum pad id (see drums.js).

export const PATTERNS = [
  {
    id: 'boombap', name: 'Boom Bap', mood: 'head-nod classic', steps: 16, swing: 0.3,
    rows: {
      kick1:  'X..x ..x. ..x. ....',
      snare1: '.... X... .... X..o',
      hat1:   'x.x. x.x. x.x. x.x.',
    },
  },
  {
    id: 'lofi', name: 'Lo-fi Nap', mood: 'sleepy and dusty', steps: 32, swing: 0.45,
    rows: {
      kick2:  'X... ..x. .x.. .... X... ..x. .x.. ..x.',
      snare3: '.... X... .... X... .... X... .... X.o.',
      hat2:   'x.o. x.o. x.o. x.o. x.o. x.o. x.o. x.xo',
      shake1: '..x. ..x. ..x. ..x. ..x. ..x. ..x. ..x.',
    },
  },
  {
    id: 'trap', name: 'Trap', mood: 'rolling hats', steps: 32, swing: 0,
    rows: {
      kick1:  'X... .... ..x. .... .x.. .... ..x. ....',
      snare2: '.... .... X... .... .... .... X... ....',
      hat1:   'x.x. x.x. x.x. xxxx x.x. x.x. xoxo xxxx',
      ohat:   '.... .... .... .... .... ...x .... ....',
      clap:   '.... .... X... .... .... .... X... ....',
    },
  },
  {
    id: 'house', name: 'House', mood: 'four on the floor', steps: 16, swing: 0,
    rows: {
      kick2: 'X... X... X... X...',
      clap:  '.... X... .... X...',
      hat1:  'x... x... x... x...',
      ohat:  '..x. ..x. ..x. ..x.',
      shake1: 'xoxo xoxo xoxo xoxo',
    },
  },
  {
    id: 'garage', name: '2-Step', mood: 'skippy and bright', steps: 16, swing: 0.4,
    rows: {
      kick2:  'X... .... ..x. ....',
      snare2: '.... X... .... X...',
      hat1:   'x.xx .xx. x.xx .xx.',
      rim:    '.... ...o .... .o..',
    },
  },
  {
    id: 'dnb', name: 'Drum & Bass', mood: 'fast and tumbly', steps: 16, swing: 0,
    rows: {
      kick2:  'X... .... ..x. ....',
      snare1: '.... X... .... X...',
      hat1:   'x.x. x.x. x.x. x.x.',
      snare3: '...o .... .o.. ...o',
    },
  },
  {
    id: 'dembow', name: 'Dembow', mood: 'sun and hips', steps: 16, swing: 0,
    rows: {
      kick1:  'X... x... X... x...',
      snare2: '...x ..x. ...x ..x.',
      hat3:   'x.x. x.x. x.x. x.x.',
      shake2: '..x. ..x. ..x. ..x.',
    },
  },
  {
    id: 'afro', name: 'Afro Bounce', mood: 'light on its feet', steps: 16, swing: 0.2,
    rows: {
      kick1:  'X... ..x. ..x. ....',
      rim:    '...x ..x. .x.. x...',
      shake1: 'x.xx x.xx x.xx x.xx',
      bell:   'x..x ..x. .x.. x...',
      tom3:   '.... .... .... ..x.',
    },
  },
  {
    id: 'funk', name: 'Funk', mood: 'ghost notes galore', steps: 16, swing: 0.15,
    rows: {
      kick2:  'X..x .... ..x. .x..',
      snare1: '.... X..o .o.. X..o',
      hat1:   'x.x. x.x. x.x. x...',
      ohat:   '.... .... .... ..x.',
    },
  },
  {
    id: 'rock', name: 'Rock', mood: 'big and simple', steps: 16, swing: 0,
    rows: {
      kick2:  'X... .... X.x. ....',
      snare1: '.... X... .... X...',
      hat2:   'x.x. x.x. x.x. x.x.',
      crash:  'x... .... .... ....',
    },
  },
  {
    id: 'bossa', name: 'Bossa', mood: 'beach at dusk', steps: 32, swing: 0,
    rows: {
      kick2:  'x..x x..x x..x x..x x..x x..x x..x x..x',
      rim:    'x..x ..x. ..x. .x.. x..x ..x. ..x. .x..',
      shake1: 'xoxo xoxo xoxo xoxo xoxo xoxo xoxo xoxo',
    },
  },
  {
    id: 'half', name: 'Half-time', mood: 'slow motion', steps: 32, swing: 0.2,
    rows: {
      kick1:  'X... .... .... ..x. .... .... .x.. ....',
      snare1: '.... .... X... .... .... .... X... ....',
      hat2:   'x.x. x.x. x.x. x.x. x.x. x.x. x.x. x.xx',
      ride:   '.... .... .... .... x... .... .... ....',
    },
  },
  {
    id: 'disco', name: 'Disco', mood: 'glitter ball', steps: 16, swing: 0,
    rows: {
      kick2:  'X... X... X... X...',
      snare1: '.... X... .... X...',
      hat1:   'x... x... x... x...',
      ohat:   '..x. ..x. ..x. ..x.',
      tamb:   '.... x... .... x...',
    },
  },
  {
    id: 'rain', name: 'Rainy Day', mood: 'soft and sparkly', steps: 32, swing: 0.25,
    rows: {
      kick1:  'x... .... ..x. .... x... .... .... ....',
      snare3: '.... .... x... .... .... .... x... ....',
      shake2: '..x. ..x. ..x. ..x. ..x. ..x. ..x. ..x.',
      rain:   'x... .... .... ..o. .... ..x. .... ....',
      pop:    '.... ...o .... .... .... .... ...o ....',
      chime:  '.... .... .... .... .... .... .... x...',
    },
  },
];
