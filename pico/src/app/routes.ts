const routes = [
  { id: "sessions", path: "/" },
  { id: "session", path: "/h/:hostId/s/:id" },
  { id: "settings", path: "/settings" },
  { id: "connect", path: "/connect" },
  { id: "welcome", path: "/welcome" },
] as const;

type RouteDefinition = (typeof routes)[number];
type AppRouteId = RouteDefinition["id"];
type SegmentParam<Segment extends string> = Segment extends `:${infer Param}` ? Param : never;
type ParamNames<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? SegmentParam<Head> | ParamNames<Tail>
  : SegmentParam<Path>;
type ParamsFor<Path extends string> = [ParamNames<Path>] extends [never]
  ? Record<never, never>
  : Record<ParamNames<Path>, string>;
type RouteParams = { [Route in RouteDefinition as Route["id"]]: ParamsFor<Route["path"]> };

export type RouteId = AppRouteId | "not-found";

export type RouteMatch =
  | { [Id in AppRouteId]: { id: Id; params: RouteParams[Id] } }[AppRouteId]
  | { id: "not-found"; params: { path: string } };

type RoutePathArgs<Id extends AppRouteId> = keyof RouteParams[Id] extends never
  ? []
  : [params: RouteParams[Id]];

interface CompiledRoute<Id extends AppRouteId = AppRouteId> {
  id: Id;
  segments: readonly RouteSegment[];
}

type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "param"; name: string };

const compiledRoutes = routes.map((route) => ({
  id: route.id,
  segments: compilePath(route.path),
})) satisfies readonly CompiledRoute[];

export const routePaths = {
  sessions: pathFor("sessions"),
  session: (hostId: string, id: string) => pathFor("session", { hostId, id }),
  settings: pathFor("settings"),
  connect: pathFor("connect"),
  welcome: pathFor("welcome"),
} as const;

function pathFor<Id extends AppRouteId>(id: Id, ...args: RoutePathArgs<Id>): string {
  const route = routes.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown route: ${id}`);
  return buildPath(route.path, args[0]);
}

function compilePath(path: string): RouteSegment[] {
  return splitPath(path).map((segment) => {
    if (segment.startsWith(":")) return { kind: "param", name: segment.slice(1) };
    return { kind: "static", value: segment };
  });
}

function buildPath(path: string, params: Record<string, string> = {}): string {
  const segments = splitPath(path).map((segment) => {
    if (!segment.startsWith(":")) return segment;
    const value = params[segment.slice(1)];
    if (value === undefined) throw new Error(`Missing route param: ${segment}`);
    return encodeURIComponent(value);
  });
  return `/${segments.join("/")}`;
}

function splitPath(path: string): string[] {
  if (path === "/") return [];

  let start = 0;
  let end = path.length;
  while (path[start] === "/") start += 1;
  while (path[end - 1] === "/") end -= 1;
  if (start >= end) return [];

  return path.slice(start, end).split("/");
}

export function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname || "/"}${search}${hash}`;
}

function pathnameOf(path: string): string {
  const searchStart = path.indexOf("?");
  const hashStart = path.indexOf("#");
  const end = Math.min(
    searchStart === -1 ? path.length : searchStart,
    hashStart === -1 ? path.length : hashStart,
  );
  const pathname = path.slice(0, end) || "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function resolveRoute(path: string): RouteMatch {
  const pathname = pathnameOf(path);
  const pathSegments = splitPath(pathname);

  for (const route of compiledRoutes) {
    const params = matchSegments(route.segments, pathSegments);
    if (!params) continue;
    return { id: route.id, params } as RouteMatch;
  }

  return { id: "not-found", params: { path: pathname } };
}

function matchSegments(routeSegments: readonly RouteSegment[], pathSegments: readonly string[]): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const pathSegment = pathSegments[index];
    if (!routeSegment || pathSegment === undefined) return null;

    if (routeSegment.kind === "static") {
      if (routeSegment.value !== pathSegment) return null;
      continue;
    }

    try {
      params[routeSegment.name] = decodeURIComponent(pathSegment);
    } catch {
      return null;
    }
  }
  return params;
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
  if (currentPath() === path) return;
  pendingNavKind = kind;
  if (kind === "replace") window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Map an incoming app URL — a `pico://connect` deep link or an in-app `/connect`
 *  path — to an internal route, or null if it isn't one we handle. */
export function pathFromAppUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "pico:" && parsed.hostname === "connect") return `${routePaths.connect}${parsed.search}`;
    if (parsed.pathname === routePaths.connect) return `${routePaths.connect}${parsed.search}`;
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
