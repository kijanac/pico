export const routePaths = {
  sessions: "/",
  session: (id: string) => `/s/${encodeURIComponent(id)}`,
  settings: "/settings",
  onboarding: "/onboarding",
  connect: "/connect",
  welcome: "/welcome",
} as const;

export type RouteId = "sessions" | "session" | "settings" | "onboarding" | "connect" | "welcome" | "not-found";

export type RouteMatch =
  | { id: "sessions"; params: Record<string, never> }
  | { id: "session"; params: { id: string } }
  | { id: "settings"; params: Record<string, never> }
  | { id: "onboarding"; params: Record<string, never> }
  | { id: "connect"; params: Record<string, never> }
  | { id: "welcome"; params: Record<string, never> }
  | { id: "not-found"; params: { path: string } };

export function currentPath(): string {
  return window.location.pathname || "/";
}

export function matchRoute(path: string): RouteMatch {
  if (path === "/") return { id: "sessions", params: {} };
  if (path === "/settings") return { id: "settings", params: {} };
  if (path === "/onboarding") return { id: "onboarding", params: {} };
  if (path === "/connect") return { id: "connect", params: {} };
  if (path === "/welcome") return { id: "welcome", params: {} };

  const sessionMatch = /^\/s\/([^/]+)$/.exec(path);
  if (sessionMatch) {
    return {
      id: "session",
      params: { id: decodeURIComponent(sessionMatch[1] ?? "") },
    };
  }

  return { id: "not-found", params: { path } };
}

/** swipe means a gesture already animated the change, so the transition layer must not animate again. */
export type NavKind = "push" | "pop" | "replace" | "swipe";

let pendingNavKind: NavKind | null = null;

/** popstate with no recorded kind is a real browser/system back. */
export function consumeNavKind(): NavKind {
  const kind = pendingNavKind ?? "pop";
  pendingNavKind = null;
  return kind;
}

export function navigateTo(path: string, kind: NavKind = "push"): void {
  if (window.location.pathname === path) return;
  pendingNavKind = kind;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Map an incoming app URL — a `pico://connect` deep link or an in-app `/connect`
 *  path — to an internal route, or null if it isn't one we handle. */
export function pathFromAppUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "pico:" && parsed.hostname === "connect") return `/connect${parsed.search}`;
    if (parsed.pathname === "/connect") return `/connect${parsed.search}`;
    return null;
  } catch {
    return null;
  }
}

/** Route an incoming app URL into the app — a deep link or a scanned pairing QR.
 *  Returns false if the URL isn't a recognized Pico link. */
export function openAppUrl(url: string): boolean {
  const path = pathFromAppUrl(url);
  if (!path) return false;
  navigateTo(path, "push");
  return true;
}
