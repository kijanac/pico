import { getPreference, setPreference } from "@/shared/mobile/preferences";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCE_KEY = "pico.theme";

let mode = $state<ThemeMode>("system");
let resolved = $state<ResolvedTheme>(systemTheme());
let loaded = $state(false);
let initialized = false;
let mediaQuery: MediaQueryList | null = null;

export const themeState = {
  get mode() {
    return mode;
  },

  get resolved() {
    return resolved;
  },

  get loaded() {
    return loaded;
  },

  init(): void {
    initThemeSync();
  },

  load(): Promise<void> {
    return loadThemePreference();
  },

  setMode(nextMode: ThemeMode): Promise<void> {
    return setThemeMode(nextMode);
  },
};

export function initThemeSync(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    if (mode === "system") applyTheme(mode);
  });
  applyTheme(mode);
}

export async function loadThemePreference(): Promise<void> {
  initThemeSync();
  const saved = normalizeThemeMode(await getPreference(THEME_PREFERENCE_KEY).catch(() => null) ?? localStorageTheme());
  mode = saved;
  applyTheme(mode);
  loaded = true;
}

export async function setThemeMode(nextMode: ThemeMode): Promise<void> {
  mode = nextMode;
  applyTheme(mode);
  try {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, mode);
  } catch {
  }
  await setPreference(THEME_PREFERENCE_KEY, mode);
}

function applyTheme(nextMode: ThemeMode): void {
  if (typeof document === "undefined") return;
  resolved = resolveTheme(nextMode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  if (nextMode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = nextMode;
}

function resolveTheme(nextMode: ThemeMode): ResolvedTheme {
  if (nextMode === "light" || nextMode === "dark") return nextMode;
  return systemTheme();
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function localStorageTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_PREFERENCE_KEY);
  } catch {
    return null;
  }
}

function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}
