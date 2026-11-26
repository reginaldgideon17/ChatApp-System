// The app has two looks. "morph" = Morphues (clean, orange). "snap" = bold, yellow, playful.
// Light/dark is separate (see theme.js), so you can mix any look with light or dark.
const STYLE_KEY = "morphues-style";
export const STYLES = ["morph", "snap"];

export function getSavedStyle() {
  try {
    const saved = localStorage.getItem(STYLE_KEY);
    return STYLES.includes(saved) ? saved : "morph";
  } catch {
    return "morph";
  }
}

export function applyStyle(style) {
  const next = STYLES.includes(style) ? style : "morph";
  try {
    localStorage.setItem(STYLE_KEY, next);
  } catch {
    /* private mode: it still changes, it just won't be remembered */
  }
  document.documentElement.dataset.style = next;
  window.dispatchEvent(new Event("app-style-change"));
}
