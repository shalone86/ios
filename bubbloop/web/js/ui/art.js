// All artwork is hand-written SVG so the app stays tiny and sharp on any
// screen: icons, bubble faces, the track mascots and the FX creatures.

const INK = '#33205a';

const stroke = (d, extra = '') => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const svg = (body, vb = '0 0 24 24', cls = '') => `<svg viewBox="${vb}" ${cls ? `class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const ICONS = {
  menu: svg(stroke('M4 7h16M4 12h16M4 17h10')),
  heart: svg('<path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.4-7 10-7 10z" fill="currentColor"/>'),
  note: svg('<path d="M9 17.5V5.5l10-2v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.5" cy="17.5" rx="3" ry="2.4" fill="currentColor"/><ellipse cx="16.5" cy="15.5" rx="3" ry="2.4" fill="currentColor"/>'),
  share: svg(stroke('M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5')),
  undo: svg(stroke('M8 5 4 9l4 4M4 9h10a5 5 0 0 1 0 10h-3')),
  redo: svg(stroke('M16 5l4 4-4 4M20 9H10a5 5 0 0 0 0 10h3')),
  play: svg('<path d="M8 5.2v13.6a1.2 1.2 0 0 0 1.8 1L20.5 13a1.2 1.2 0 0 0 0-2L9.8 4.2a1.2 1.2 0 0 0-1.8 1z" fill="currentColor"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"/>'),
  bubbles: svg('<circle cx="8" cy="14" r="5" fill="currentColor"/><circle cx="17" cy="8" r="3.4" fill="currentColor" opacity=".8"/><circle cx="18" cy="17" r="2.2" fill="currentColor" opacity=".6"/>'),
  sparkle: svg('<path d="M11 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z" fill="currentColor"/><path d="M18.5 15c.3 2 1.2 2.900 3 3.200-1.800.3-2.700 1.200-3 3.300-.3-2.100-1.200-3-3-3.300 1.800-.3 2.700-1.200 3-3.200z" fill="currentColor" opacity=".7"/>'),
  sliders: svg(stroke('M6 4v16M12 4v16M18 4v16') + '<circle cx="6" cy="9" r="2.6" fill="currentColor"/><circle cx="12" cy="15" r="2.6" fill="currentColor"/><circle cx="18" cy="8" r="2.6" fill="currentColor"/>'),
  song: svg('<rect x="3" y="5" width="5" height="5" rx="2.5" fill="currentColor"/><rect x="10" y="5" width="5" height="5" rx="2.5" fill="currentColor" opacity=".45"/><rect x="17" y="5" width="5" height="5" rx="2.5" fill="currentColor"/><rect x="3" y="14" width="5" height="5" rx="2.5" fill="currentColor" opacity=".45"/><rect x="10" y="14" width="5" height="5" rx="2.5" fill="currentColor"/><rect x="17" y="14" width="5" height="5" rx="2.5" fill="currentColor"/>'),
  lock: svg('<rect x="5" y="10.500" width="14" height="10" rx="3" fill="currentColor"/>' + stroke('M8 10.500V8a4 4 0 0 1 8 0v2.500')),
  trash: svg(stroke('M5 7h14M10 7V4.500h4V7M7 7l1 12.500h8L17 7')),
  plus: svg(stroke('M12 5v14M5 12h14')),
  copy: svg(stroke('M9 9h10v11H9zM5 15V4h10')),
  left: svg(stroke('M14 6l-6 6 6 6')),
  right: svg(stroke('M10 6l6 6-6 6')),
  eraser: svg(stroke('M4 16.500 13.500 7a2 2 0 0 1 2.800 0l3.200 3.200a2 2 0 0 1 0 2.800L13 19.500H7z M9.500 11l5 5 M13 19.500h7')),
  steps: svg('<circle cx="5" cy="12" r="2.600" fill="currentColor"/><circle cx="12" cy="12" r="2.600" fill="currentColor" opacity=".4"/><circle cx="19" cy="12" r="2.600" fill="currentColor"/>'),
  check: svg(stroke('M5 12.500l4.500 4.500L19 7.500')),
  gear: svg('<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2.200"/>' + stroke('M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800')),
  metro: svg(stroke('M8 20 10.500 4h3L16 20zM12 14l5-7')),
  loop: svg(stroke('M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1')),
};

export function mountIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach((el) => {
    const name = el.dataset.ico;
    if (ICONS[name] && el.dataset.done !== name) { el.innerHTML = ICONS[name]; el.dataset.done = name; }
  });
}
export const icon = (name) => `<span class="ico">${ICONS[name] || ''}</span>`;

// ---------- bubble face ----------

export const FACE = svg(`
  <g class="f-idle">
    <g class="eye"><ellipse cx="13" cy="18" rx="2.700" ry="3.500" fill="${INK}"/><circle cx="14" cy="16.600" r="1" fill="#fff"/></g>
    <g class="eye"><ellipse cx="27" cy="18" rx="2.700" ry="3.500" fill="${INK}"/><circle cx="28" cy="16.600" r="1" fill="#fff"/></g>
    <path d="M16.800 24.500q3.200 3.200 6.400 0" fill="none" stroke="${INK}" stroke-width="1.700" stroke-linecap="round"/>
  </g>
  <g class="f-sing">
    <path d="M10 19.500q3-4.500 6 0M24 19.500q3-4.500 6 0" fill="none" stroke="${INK}" stroke-width="1.900" stroke-linecap="round"/>
    <ellipse cx="20" cy="27" rx="3.400" ry="4" fill="${INK}"/><ellipse cx="20" cy="28.800" rx="2" ry="1.700" fill="#ff7fa5"/>
  </g>
  <ellipse cx="7.500" cy="24" rx="3.200" ry="1.900" fill="#ff5c93" opacity=".42"/>
  <ellipse cx="32.500" cy="24" rx="3.200" ry="1.900" fill="#ff5c93" opacity=".42"/>`, '0 0 40 40');

// ---------- mascots ----------

const eyes = (x1, x2, y, r = 2.600) => `
  <g class="awake">
    <ellipse cx="${x1}" cy="${y}" rx="${r}" ry="${r * 1.250}" fill="${INK}"/><circle cx="${x1 + 0.900}" cy="${y - 1.200}" r="${r * 0.380}" fill="#fff"/>
    <ellipse cx="${x2}" cy="${y}" rx="${r}" ry="${r * 1.250}" fill="${INK}"/><circle cx="${x2 + 0.900}" cy="${y - 1.200}" r="${r * 0.380}" fill="#fff"/>
  </g>
  <g class="asleep">
    <path d="M${x1 - 3} ${y}q3 3 6 0M${x2 - 3} ${y}q3 3 6 0" fill="none" stroke="${INK}" stroke-width="1.800" stroke-linecap="round"/>
    <text x="50" y="14" font-size="11" font-weight="700" fill="#fff" font-family="Fredoka, sans-serif">z</text>
    <text x="56" y="8" font-size="8" font-weight="700" fill="#fff" font-family="Fredoka, sans-serif">z</text>
  </g>`;
const smile = (x, y, w = 5) => `<path d="M${x - w / 2} ${y}q${w / 2} ${w * 0.550} ${w} 0" fill="none" stroke="${INK}" stroke-width="1.800" stroke-linecap="round"/>`;
const cheeks = (x1, x2, y) => `<ellipse cx="${x1}" cy="${y}" rx="3.400" ry="2" fill="#ff5c93" opacity=".45"/><ellipse cx="${x2}" cy="${y}" rx="3.400" ry="2" fill="#ff5c93" opacity=".45"/>`;

const MASCOT_ART = {
  drums: `
    <path d="M15 9l12 15M49 9 37 24" stroke="#d9a066" stroke-width="3.600" stroke-linecap="round"/>
    <circle cx="14" cy="8" r="4.200" fill="#ffe2b0"/><circle cx="50" cy="8" r="4.200" fill="#ffe2b0"/>
    <path d="M9 30v16c0 6 10 11 23 11s23-5 23-11V30z" fill="#ff8fa8"/>
    <path d="M9 38l7.700 9 7.600-9 7.700 9 7.700-9 7.600 9 7.700-9" fill="none" stroke="#ffd3dc" stroke-width="1.800" stroke-linejoin="round" opacity=".9"/>
    <ellipse cx="32" cy="30" rx="23" ry="9" fill="#fff6e6" stroke="#ffc0cd" stroke-width="2.200"/>
    ${eyes(25, 39, 46)}${smile(32, 50)}${cheeks(19, 45, 50.500)}`,
  bass: `
    <path d="M51 30c5-4 8-9 8-13-4 0-8 2-10 6-2-4-5-6-9-6 0 5 3 10 7 13z" fill="#5fb0f0"/>
    <path d="M6 38c0-11 10-19 23-19s23 8 23 19-10 18-23 18S6 49 6 38z" fill="#7fc6ff"/>
    <path d="M9 44c4 7 11 11 20 11s16-4 20-11c-6 3-13 4-20 4s-14-1-20-4z" fill="#e8f6ff"/>
    <path d="M26 14c-1-4-4-6-7-6M30 13c0-4 2-7 5-8" fill="none" stroke="#c9ecff" stroke-width="2.400" stroke-linecap="round"/>
    ${eyes(19, 35, 36)}${smile(27, 41)}${cheeks(13.500, 40.500, 41)}`,
  pads: `
    <circle cx="19" cy="38" r="13" fill="#f3ecff"/><circle cx="45" cy="38" r="13" fill="#f3ecff"/>
    <circle cx="27" cy="27" r="13" fill="#fff"/><circle cx="40" cy="29" r="11" fill="#fff"/>
    <rect x="14" y="36" width="36" height="16" rx="8" fill="#f3ecff"/>
    <path d="M12 46c6 5 34 5 40 0" fill="none" stroke="#d9ccff" stroke-width="2" stroke-linecap="round" opacity=".8"/>
    ${eyes(25, 39, 37)}${smile(32, 42)}${cheeks(18.500, 45.500, 42)}`,
  melody: `
    <path d="M32 5c2 0 3.300 1.200 4.200 3l5 10.200 11.300 1.700c4 .6 5.600 5.400 2.700 8.200l-8.200 8 2 11.300c.700 4-3.500 7-7 5.100L32 47.100 22 52.500c-3.500 1.900-7.700-1.100-7-5.100l2-11.300-8.200-8c-2.900-2.800-1.300-7.600 2.700-8.200l11.300-1.700 5-10.200C28.700 6.200 30 5 32 5z" fill="#ffd966" stroke="#ffb938" stroke-width="2"/>
    ${eyes(26, 38, 28)}${smile(32, 33)}${cheeks(20.500, 43.500, 33)}`,
};

const HUE_SHIFT = [0, 70, -60, 150, 200, 110, -120, 30];

export function mascot(role, variant = 0, cls = '') {
  const shift = HUE_SHIFT[variant % HUE_SHIFT.length];
  const style = shift ? ` style="filter:hue-rotate(${shift}deg)"` : '';
  return `<svg class="mascot ${cls}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><g${style}>${MASCOT_ART[role] || MASCOT_ART.melody}</g></svg>`;
}

export const ROLE_COLOR = { drums: '#ff8fa8', bass: '#7fc6ff', pads: '#d6c4ff', melody: '#ffd966' };
export const ROLE_COLOR_LO = { drums: '#e2546f', bass: '#3e8fd8', pads: '#9a7cf0', melody: '#f0a530' };

// ---------- instrument glyphs ----------

const glyph = (bg, body) => `<svg class="art" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="${bg}"/>${body}</svg>`;
const S = (d, w = 2.600, c = INK) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const GLYPHS = {
  keys: glyph('#ffe1ee', `<rect x="11" y="14" width="26" height="20" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.200"/>${S('M19.700 14v20M28.300 14v20', 1.800)}<rect x="16.700" y="14" width="5.600" height="11" rx="1.500" fill="${INK}"/><rect x="25.600" y="14" width="5.600" height="11" rx="1.500" fill="${INK}"/>`),
  pipes: glyph('#e4f7ea', `<rect x="12" y="18" width="6" height="18" rx="3" fill="${INK}"/><rect x="21" y="11" width="6" height="25" rx="3" fill="${INK}"/><rect x="30" y="15" width="6" height="21" rx="3" fill="${INK}"/>`),
  bolt: glyph('#fff1c4', `<path d="M27 9 14 26h8l-2 13 14-18h-8z" fill="${INK}"/>`),
  bass: glyph('#dcefff', `<circle cx="19" cy="30" r="8" fill="${INK}"/><circle cx="19" cy="30" r="2.600" fill="#dcefff"/>${S('M24 25 36 12M33 11l5 5', 3)}`),
  wave: glyph('#e9e1ff', S('M9 28c3-12 6-12 9 0s6 12 9 0 6-12 9 0', 3)),
  drum: glyph('#ffe1e6', `<ellipse cx="24" cy="20" rx="13" ry="5.500" fill="#fff" stroke="${INK}" stroke-width="2.200"/>${S('M11 20v10c0 3 6 5.500 13 5.500S37 33 37 30V20', 2.200)}`),
  sing: glyph('#ffe9d2', `<circle cx="17.500" cy="20" r="2.300" fill="${INK}"/><circle cx="30.500" cy="20" r="2.300" fill="${INK}"/><ellipse cx="24" cy="30" rx="5" ry="6" fill="${INK}"/><ellipse cx="24" cy="32.500" rx="3" ry="2.400" fill="#ff7fa5"/>`),
  bow: glyph('#e4f7ea', `${S('M14 12v24M20 12v24M26 12v24M32 12v24', 1.800)}${S('M9 30 39 18', 3.200, '#c4763a')}`),
  horn: glyph('#fff1c4', `<path d="M10 21h14l12-8v22l-12-8H10z" fill="${INK}"/>${S('M15 27v6h5v-6', 2.200)}`),
  cloud: glyph('#e9e1ff', `<path d="M15 32a6 6 0 0 1 .500-12 8 8 0 0 1 15.500-1.500A6.500 6.500 0 0 1 33 32z" fill="#fff" stroke="${INK}" stroke-width="2.200" stroke-linejoin="round"/>`),
  star: glyph('#fff1c4', `<path d="M24 10l4.200 8.600 9.500 1.400-6.900 6.700 1.600 9.400L24 31.700l-8.400 4.400 1.600-9.400-6.900-6.700 9.500-1.400z" fill="${INK}"/>`),
  leaf: glyph('#e4f7ea', `<rect x="12" y="12" width="24" height="26" rx="6" fill="#fff" stroke="${INK}" stroke-width="2.200"/>${S('M18 12v14M24 12v19M30 12v14', 2.600)}`),
  pixel: glyph('#ffe1ee', `<path d="M14 14h6v4h8v-4h6v4h4v8h-4v4h-4v4h-4v4h-4v-4h-4v-4h-4v-4h-4v-8h4z" fill="${INK}"/>`),
};

// ---------- FX creatures ----------

const fxFace = (x1, x2, y, my) => `<circle cx="${x1}" cy="${y}" r="2.400" fill="${INK}"/><circle cx="${x2}" cy="${y}" r="2.400" fill="${INK}"/>${smile((x1 + x2) / 2, my, 5)}`;
const fx = (body) => `<svg class="art" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const FX_ART = {
  reverb: fx(`<circle cx="21" cy="36" r="12" fill="#fff"/><circle cx="43" cy="36" r="12" fill="#fff"/><circle cx="31" cy="27" r="13" fill="#fff"/><rect x="16" y="34" width="32" height="14" rx="7" fill="#fff"/>${fxFace(26, 38, 35, 40)}<path d="M52 12c.500 3 1.800 4.300 5 5-3.200.500-4.500 1.800-5 5-.500-3.200-1.800-4.500-5-5 3.200-.700 4.500-2 5-5z" fill="#fff6c9"/>`),
  delay: fx(`<circle cx="46" cy="34" r="13" fill="#fff" opacity=".3"/><circle cx="36" cy="34" r="14" fill="#fff" opacity=".55"/><circle cx="24" cy="34" r="15" fill="#fff"/>${fxFace(19, 29, 32, 37)}`),
  squish: fx(`<path d="M32 8v8M27 12l5 5 5-5M32 56v-8M27 52l5-5 5 5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/><ellipse cx="32" cy="32" rx="24" ry="11" fill="#fff"/>${fxFace(25, 39, 30, 34)}`),
  crunch: fx(`<path d="M32 7l5.500 9.500 10.500-3-3 10.500L54.500 32 45 37.500l3 10.500-10.500-3L32 56.500 26.500 45 16 48l3-10.500L9.500 32 19 26.500l-3-10.500 10.500 3z" fill="#fff"/>${fxFace(26, 38, 30, 36)}`),
  stutter: fx(`<rect x="34" y="16" width="24" height="32" rx="9" fill="#fff" opacity=".3"/><rect x="21" y="16" width="24" height="32" rx="9" fill="#fff" opacity=".55"/><rect x="7" y="16" width="26" height="32" rx="10" fill="#fff"/>${fxFace(15, 25, 30, 36)}`),
  glitch: fx(`<path d="M12 14h26v10h14v12H40v14H14V38H8V24h4z" fill="#fff"/><rect x="44" y="12" width="10" height="6" fill="#fff" opacity=".6"/><rect x="6" y="44" width="6" height="6" fill="#fff" opacity=".6"/><circle cx="21" cy="29" r="2.400" fill="${INK}"/><circle cx="33" cy="33" r="2.400" fill="${INK}"/><path d="M22 40h4v-3h5" fill="none" stroke="${INK}" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/>`),
  filter: fx(`<path d="M4 22c7-8 12-8 19 0s12 8 19 0 12-8 18 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/><path d="M14 40c0-7 7-12 16-12s17 5 20 12c-3 7-11 12-20 12s-16-5-16-12z" fill="#fff"/><path d="M50 40l9-7v14z" fill="#fff"/>${fxFace(24, 36, 38, 43)}<circle cx="10" cy="34" r="2.400" fill="#fff" opacity=".7"/><circle cx="7" cy="27" r="1.600" fill="#fff" opacity=".6"/>`),
  tape: fx(`<path d="M40 8a25 25 0 1 0 16 38A21 21 0 0 1 40 8z" fill="#fff"/><path d="M22 33q3 3 6 0M33 36q3 3 6 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><path d="M27 43q2.500 2 5 0" fill="none" stroke="${INK}" stroke-width="1.800" stroke-linecap="round"/><text x="46" y="26" font-size="12" font-weight="700" fill="#fff" font-family="Fredoka, sans-serif">z</text><text x="54" y="17" font-size="9" font-weight="700" fill="#fff" font-family="Fredoka, sans-serif">z</text>`),
};

export const DONE_ART = `<svg class="done-art" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <circle cx="60" cy="62" r="44" fill="#ffd966" stroke="#ffb938" stroke-width="4"/>
  <path d="M40 54q7-10 14 0M66 54q7-10 14 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M44 70q16 18 32 0z" fill="${INK}"/><path d="M52 78q8 6 16 0-8-3-16 0z" fill="#ff7fa5"/>
  <ellipse cx="33" cy="68" rx="7" ry="4" fill="#ff5c93" opacity=".45"/><ellipse cx="87" cy="68" rx="7" ry="4" fill="#ff5c93" opacity=".45"/>
  <path d="M100 16c1 6 3.600 8.600 10 10-6.400 1-9 3.600-10 10-1-6.400-3.600-9-10-10 6.400-1.400 9-4 10-10z" fill="#ff9cc2"/>
  <path d="M18 20c.700 4 2.400 5.700 6.500 6.500-4.100.700-5.800 2.400-6.500 6.500-.700-4.100-2.400-5.800-6.500-6.500 4.100-.800 5.800-2.500 6.500-6.500z" fill="#8ad6ff"/></svg>`;
