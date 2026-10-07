export type ThemeMode = "system" | "light" | "dark";
export type Palette = "pico" | "brass";

// index.html applies the saved mode and palette before first paint from the same keys.
const STORAGE_KEY = "pico.theme";
const PALETTE_KEY = "pico.palette";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let mode = $state<ThemeMode>(saved(STORAGE_KEY, ["light", "dark"], "system"));
let palette = $state<Palette>(saved(PALETTE_KEY, ["brass"], "pico"));

function saved<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return values.find((candidate) => candidate === value) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice still applies for this visit.
  }
}

function applyTheme(): void {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark" || (mode === "system" && darkQuery.matches));
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  if (palette === "pico") delete root.dataset.palette;
  else root.dataset.palette = palette;
}

export const themeState = {
  get mode() {
    return mode;
  },

  get palette() {
    return palette;
  },

  // Applies the mode and follows the OS appearance while it is "system".
  init(): void {
    darkQuery.addEventListener("change", applyTheme);
    applyTheme();
  },

  setMode(next: ThemeMode): void {
    mode = next;
    applyTheme();
    save(STORAGE_KEY, next);
  },

  setPalette(next: Palette): void {
    palette = next;
    applyTheme();
    save(PALETTE_KEY, next);
  },
};
