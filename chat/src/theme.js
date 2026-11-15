const THEME_STORAGE_KEY = "dream-theme";

// Light is the default. Only people who explicitly chose dark keep dark.
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
  } catch {}
  document.documentElement.dataset.theme = nextTheme;
  window.dispatchEvent(new Event("app-theme-change"));
}
