// New key name: older versions saved "dark" for everybody by default, so a fresh key
// lets everyone start on the new light look. Anyone who then picks dark keeps it.
const THEME_STORAGE_KEY = "morphues-theme";

export function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    /* private mode: the theme still changes, it just won't be remembered */
  }
  document.documentElement.dataset.theme = nextTheme;
  window.dispatchEvent(new Event("app-theme-change"));
}
