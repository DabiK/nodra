export type Theme = "light" | "dark";

const KEY = "nodra.theme";

/** Apply the given theme to the document root (drives the `data-theme` CSS attribute). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** System preference, without consulting any persisted user choice. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Persisted explicit user choice, if any. */
export function loadTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

/** Persist the explicit theme so it survives navigation and reloads. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore storage failures (quota / private mode) */
  }
}

/**
 * Resolve and apply the initial theme: the explicit user choice when present,
 * otherwise the OS preference. The inline script in `index.html` already set
 * `data-theme` before first paint to avoid a flash; this just re-applies it
 * consistently (and upgrades legacy sessions with no stored choice).
 */
export function initTheme(): Theme {
  const theme = loadTheme() ?? systemTheme();
  applyTheme(theme);
  return theme;
}
