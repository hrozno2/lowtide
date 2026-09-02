/* Editor themes.
 *
 * Each theme names six colours; every other token in the palette is derived
 * from them, so a new theme is six lines and can't drift out of tune.
 */

const hexToRgb = (h) => {
  const v = h.replace('#', '');
  const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};
const toHex = (rgb) =>
  '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t));
};
const alpha = (h, a) => {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const luminance = (h) => {
  const [r, g, b] = hexToRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export const contrast = (a, b) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * Lightens or darkens `fg` — whichever way moves it away from `bg` — by the
 * least amount that reaches `min`, keeping its hue.
 *
 * Themes are written as six colours each and the rest is derived, which is
 * what keeps them consistent; but a derivation that reads well on one
 * background can be unreadable on another, and the dim tokens especially were
 * mixed so far toward the background that labels fell below three to one in
 * every theme. Correcting here rather than by hand means it cannot come back,
 * and a theme that already passes is left exactly as it was.
 */
function ensureContrast(fg, bg, min) {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.18 ? '#000000' : '#ffffff';
  if (contrast(target, bg) < min) return target;   // nothing more to give
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(fg, target, mid), bg) >= min) hi = mid; else lo = mid;
  }
  return mix(fg, target, hi);
}

export const THEMES = [
  { id: 'material', name: 'Material', dark: true,
    // Slate rather than sage: green no longer leads the surface or the text.
    bg: '#262e30', text: '#ccd4d6', primary: '#4ec5c2', rule: '#e0897b', note: '#e0b44c' },
  { id: 'midnight', name: 'Midnight', dark: true,
    bg: '#12161c', text: '#ccd3de', primary: '#6ea8fe', rule: '#f08c8c', note: '#e3c06a' },
  { id: 'dracula', name: 'Dracula', dark: true,
    bg: '#282a36', text: '#f2f3f7', primary: '#bd93f9', rule: '#ff79c6', note: '#f1fa8c' },
  { id: 'monokai', name: 'Monokai', dark: true,
    bg: '#272822', text: '#f3f2e7', primary: '#a6e22e', rule: '#fd971f', note: '#e6db74' },
  { id: 'solarized-dark', name: 'Solarized Dark', dark: true,
    bg: '#002b36', text: '#c3ccc7', primary: '#2aa198', rule: '#cb4b16', note: '#b58900' },
  { id: 'nord', name: 'Nord', dark: true,
    bg: '#2e3440', text: '#d8dee9', primary: '#88c0d0', rule: '#bf616a', note: '#ebcb8b' },
  { id: 'paper', name: 'Paper', dark: false,
    bg: '#f6f3ec', text: '#22201c', primary: '#0f766e', rule: '#b4462f', note: '#9a6b12' },
  { id: 'clean', name: 'Clean', dark: false,
    bg: '#ffffff', text: '#1d2125', primary: '#1a7f6b', rule: '#c0492c', note: '#8a6410' },
  { id: 'solarized-light', name: 'Solarized Light', dark: false,
    bg: '#fdf6e3', text: '#33403f', primary: '#2aa198', rule: '#cb4b16', note: '#b58900' },
  { id: 'winter', name: 'Winter', dark: false,
    bg: '#eef2f6', text: '#1f2a37', primary: '#2563a8', rule: '#a8443a', note: '#8a6410' }
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** The five chips shown in the picker. */
export function swatches(theme) {
  return [theme.bg, mix(theme.bg, theme.text, 0.18), theme.primary, theme.rule, theme.note];
}

/** The full palette a theme resolves to. Exported so it can be measured. */
export function paletteFor(id) {
  return tokensFor(themeById(id));
}

function tokensFor(t) {
  const { bg, text, primary, rule, note } = t;

  const surface = mix(bg, text, t.dark ? 0.035 : 0.045);
  const surface2 = mix(bg, text, 0.075);

  /* Body copy is held to the AA ratio of 4.5; labels and dim metadata to 3.2,
     a little over the large-text bar, since they support the writing rather
     than being the thing read. Each is measured against what actually sits
     behind it. */
  const fit = ensureContrast;

  /* The accent as it will actually be painted. Anything written on top has to
     be measured against this, not against the theme's raw colour: on
     Solarized Light the two differ enough to swap which of black and white is
     the readable one. */
  const accent = fit(primary, bg, 4.5);
  const onAccent = (() => {
    const better = (a, b) => (contrast(a, accent) >= contrast(b, accent) ? a : b);
    const soft = better('#0b0f0f', '#f7fdfc');
    return contrast(soft, accent) >= 4.5 ? soft : better('#000000', '#ffffff');
  })();

  return {
    '--bg': bg,
    '--surface': surface,
    '--surface-2': surface2,
    '--surface-3': mix(bg, text, 0.13),
    '--surface-4': mix(bg, text, 0.19),
    '--outline': mix(bg, text, 0.24),
    '--outline-soft': mix(bg, text, 0.11),

    '--text': fit(text, surface, 4.5),
    '--text-2': fit(mix(text, bg, 0.26), surface2, 4.5),
    '--text-3': fit(mix(text, bg, 0.44), surface2, 3.6),
    '--text-4': fit(mix(text, bg, 0.58), surface2, 3.2),

    '--primary': accent,
    '--primary-2': fit(mix(primary, bg, 0.2), bg, 4.5),
    '--primary-dim': mix(primary, bg, 0.58),
    '--primary-ghost': alpha(primary, 0.13),
    '--primary-glow': alpha(primary, 0.26),
    '--stat': fit(mix(primary, text, 0.32), surface, 3.6),

    /* What to write on top of the accent: whichever of near-black and
       near-white actually contrasts better against it, then held to the
       reading ratio. Picking by the accent's lightness alone gets mid-tone
       accents wrong, and a mid-tone accent is exactly where it matters. */
    /* Near-black or near-white, whichever the accent takes; pure only when the
       accent is an awkward mid-tone and nothing softer will clear the bar. */
    '--on-primary': onAccent,

    '--note': fit(note, bg, 4.5),
    '--note-ghost': alpha(note, 0.13),
    '--rule': fit(rule, bg, 4.5),
    '--caret': fit(rule, bg, 3.0),

    '--selection': alpha(primary, 0.22),
    '--selection-off': alpha(mix(text, bg, 0.35), 0.2),
    '--scroll-thumb': alpha(text, 0.18),
    '--scroll-thumb-hover': alpha(text, 0.32)
  };
}

export function applyTheme(id) {
  const theme = themeById(id);
  const root = document.documentElement;
  const tokens = tokensFor(theme);
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  document.body.classList.toggle('light-theme', !theme.dark);
  return theme;
}
