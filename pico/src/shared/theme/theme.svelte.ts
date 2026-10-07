export type ThemeMode = "system" | "light" | "dark";

// index.html applies the saved mode before first paint from the same key.
const STORAGE_KEY = "pico.theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let mode = $state<ThemeMode>(savedMode());

function savedMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(): void {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark" || (mode === "system" && darkQuery.matches));
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
}

export const themeState = {
  get mode() {
    return mode;
  },

  // Applies the mode and follows the OS appearance while it is "system".
  init(): void {
    darkQuery.addEventListener("change", applyTheme);
    applyTheme();
  },

  setMode(next: ThemeMode): void {
    mode = next;
    applyTheme();
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice still applies for this visit.
    }
  },
};
