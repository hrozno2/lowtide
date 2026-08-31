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

export const THEMES = [
  { id: 'material', name: 'Material', dark: true,
    bg: '#26302f', text: '#cbd6d2', primary: '#4ec7b8', rule: '#e0897b', note: '#e0b44c' },
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

function tokensFor(t) {
  const { bg, text, primary, rule, note } = t;
  return {
    '--bg': bg,
    '--surface': mix(bg, text, t.dark ? 0.035 : 0.045),
    '--surface-2': mix(bg, text, 0.075),
    '--surface-3': mix(bg, text, 0.13),
    '--surface-4': mix(bg, text, 0.19),
    '--outline': mix(bg, text, 0.24),
    '--outline-soft': mix(bg, text, 0.11),

    '--text': text,
    '--text-2': mix(text, bg, 0.26),
    '--text-3': mix(text, bg, 0.48),
    '--text-4': mix(text, bg, 0.64),

    '--primary': primary,
    '--primary-2': mix(primary, bg, 0.28),
    '--primary-dim': mix(primary, bg, 0.58),
    '--primary-ghost': alpha(primary, 0.13),
    '--primary-glow': alpha(primary, 0.26),
    '--stat': mix(primary, text, 0.32),

    '--note': note,
    '--note-ghost': alpha(note, 0.13),
    '--rule': rule,
    '--caret': rule,

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
