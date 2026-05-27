/**
 * Entry point — Node.
 *
 *   - Hono handles HTTP via @hono/node-server
 *   - WebSocket upgrade is intercepted on the underlying Node http.Server
 *     and routed through the `ws` package
 *   - One ManagedRuntime carries the Effect layers (SessionManager + PiClient)
 *     and is shared across all HTTP and WS callbacks
 */
import { Effect, Layer, ManagedRuntime, Logger, LogLevel } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath, sep as PATH_SEP } from "node:path";
import { homedir } from "node:os";
import * as v from "valibot";
import { PiClientFromEnv } from "./pi.ts";
import { SessionManager, SessionManagerLive } from "./session.ts";
import { StoreLive } from "./store.ts";
import { makeConnectionHandler, type WsBindings } from "./ws.ts";

const PORT = Number(process.env.PORT ?? 7777);
// 0.0.0.0 by convenience in dev (so you can open the bridge from your
// LAN). Production sets HOST=127.0.0.1 so the only reachable surface
// is via `tailscale serve`, which proxies tailnet → localhost.
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_PATH = process.env.BRIDGE_DB ?? "data/bridge.db";
const USING_MOCK = process.env.PI_USE_MOCK === "1";

// Ensure the directory for the DB file exists before opening.
mkdirSync(dirname(DB_PATH), { recursive: true });

/* ── runtime ─────────────────────────────────────────────────────────── */

const AppLayer = SessionManagerLive.pipe(
  Layer.provide(Layer.mergeAll(PiClientFromEnv, StoreLive(DB_PATH))),
);
const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppLayer, Logger.minimumLogLevel(LogLevel.Info)),
);

const onConnection = makeConnectionHandler(runtime);

/* ── HTTP routes ─────────────────────────────────────────────────────── */

const CreateBody = v.object({
  cwd: v.string(),
  title: v.optional(v.string()),
  branch: v.optional(v.string()),
});

// Allowed fields on PATCH /sessions/:id. Both optional — but at least
// one must be present or the request is a no-op (we reject empty
// bodies to surface obvious client bugs).
const PatchBody = v.object({
  title: v.optional(v.string()),
  archived: v.optional(v.boolean()),
});

const app = new Hono();

// Capacitor serves the app from a custom origin such as
// capacitor://localhost. REST calls to the tailnet HTTPS bridge are therefore
// cross-origin inside the WebView even though curl/Safari can reach them.
// The bridge is protected by Tailscale, not by browser same-origin policy, so
// allow browser clients through CORS.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type"],
  }),
);

app.get("/healthz", (c) => c.text("ok"));

app.get("/sessions", async (c) => {
  const list = await runtime.runPromise(
    Effect.flatMap(SessionManager, (m) => m.list()),
  );
  return c.json(list);
});

app.post("/sessions", async (c) => {
  const body = v.safeParse(CreateBody, await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid_body", issues: body.issues }, 400);
  }
  const meta = await runtime
    .runPromise(Effect.flatMap(SessionManager, (m) => m.create(body.output)))
    .catch((e: unknown) => {
      console.error("create failed:", e);
      return null;
    });
  if (!meta) return c.json({ error: "create_failed" }, 500);
  return c.json(meta, 201);
});

app.get("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const opt = await runtime.runPromise(
    Effect.flatMap(SessionManager, (m) => m.get(id)),
  );
  if (opt._tag === "None") return c.json({ error: "not_found" }, 404);
  return c.json(opt.value);
});

/**
 * Partial update: rename, archive, or restore from archive. Returns
 * the updated SessionMeta on success.
 *
 *   PATCH /sessions/:id   { "title": "new name" }
 *   PATCH /sessions/:id   { "archived": true }   # archive
 *   PATCH /sessions/:id   { "archived": false }  # restore
 *
 * Empty bodies are rejected with 400 — a client that wants a no-op
 * patch is almost certainly a bug.
 */
app.patch("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const body = v.safeParse(PatchBody, await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid_body", issues: body.issues }, 400);
  }
  if (
    body.output.title === undefined &&
    body.output.archived === undefined
  ) {
    return c.json({ error: "empty_patch" }, 400);
  }

  const result = await runtime
    .runPromiseExit(
      Effect.flatMap(SessionManager, (m) => m.patch(id, body.output)),
    );
  if (result._tag === "Failure") {
    // SessionNotFound is the only tagged failure that surfaces here.
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(result.value);
});

/**
 * Hard delete. Removes the session row and every persisted event for
 * it. Live PiSession is torn down; subscribers see the WS close.
 */
app.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const result = await runtime.runPromiseExit(
    Effect.flatMap(SessionManager, (m) => m.remove(id)),
  );
  if (result._tag === "Failure") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.body(null, 204);
});

/* ── slash commands ──────────────────────────────────────────────────── */

/**
 * Pi's built-in slash commands (hand-curated from pi 0.65+ docs). We
 * surface only the commands a mobile user can plausibly act on; commands
 * like /hotkeys that are TUI-specific are omitted.
 */
const BUILTIN_COMMANDS: Array<{
  name: string;
  description: string;
  takesArgs?: boolean;
}> = [
  { name: "new", description: "Start a new session" },
  { name: "resume", description: "Browse and resume a past session" },
  { name: "fork", description: "Fork the current session at this point" },
  { name: "clone", description: "Duplicate the active branch" },
  { name: "tree", description: "Show the session tree" },
  { name: "compact", description: "Summarize older messages", takesArgs: true },
  { name: "model", description: "Pick a different model" },
  { name: "login", description: "Authenticate with a provider" },
  { name: "settings", description: "Open settings" },
  { name: "export", description: "Export session to HTML", takesArgs: true },
  { name: "share", description: "Share session as a gist" },
  { name: "rename", description: "Rename the session", takesArgs: true },
];

interface CommandEntry {
  kind: "builtin" | "prompt" | "skill";
  name: string;
  description: string;
  /** True if the command accepts trailing arguments. */
  takesArgs?: boolean;
  /** Source path for diagnostics (prompts/skills only). */
  source?: string;
}

/**
 * Parse a tiny subset of YAML frontmatter: a `---` fenced header at the
 * top of a markdown file with `key: value` lines. Returns an empty
 * object if no frontmatter is present. We don't need a real YAML parser
 * because the only field we care about is `description`.
 */
function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[m[1]] = value;
  }
  return { meta, body: match[2] };
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

function loadPromptTemplates(): CommandEntry[] {
  const dir = `${homedir()}${PATH_SEP}.pi${PATH_SEP}agent${PATH_SEP}prompts`;
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CommandEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const name = file.slice(0, -3);
    try {
      const path = `${dir}${PATH_SEP}${file}`;
      const text = readFileSyncUtf8(path);
      if (text === null) continue;
      const { meta, body } = parseFrontmatter(text);
      const description = meta.description || firstNonEmptyLine(body) || name;
      out.push({
        kind: "prompt",
        name,
        description,
        // All templates support $1 / $@ — surface as args-capable.
        takesArgs: true,
        source: path,
      });
    } catch {
      // Skip malformed files.
    }
  }
  return out;
}

function loadSkills(): CommandEntry[] {
  const dir = `${homedir()}${PATH_SEP}.pi${PATH_SEP}agent${PATH_SEP}skills`;
  let subdirs: string[];
  try {
    subdirs = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CommandEntry[] = [];
  for (const skillDir of subdirs) {
    if (skillDir.startsWith(".")) continue;
    const skillPath = `${dir}${PATH_SEP}${skillDir}`;
    let stat;
    try {
      stat = statSync(skillPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const skillFile = `${skillPath}${PATH_SEP}SKILL.md`;
    const text = readFileSyncUtf8(skillFile);
    if (text === null) continue;
    const { meta, body } = parseFrontmatter(text);
    const description =
      meta.description || firstNonEmptyLine(body) || skillDir;
    out.push({
      kind: "skill",
      name: `skill:${skillDir}`,
      description,
      takesArgs: true,
      source: skillFile,
    });
  }
  return out;
}

function readFileSyncUtf8(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

app.get("/commands", (c) => {
  const builtins: CommandEntry[] = BUILTIN_COMMANDS.map((b) => ({
    kind: "builtin",
    name: b.name,
    description: b.description,
    takesArgs: b.takesArgs,
  }));
  return c.json({
    builtins,
    prompts: loadPromptTemplates(),
    skills: loadSkills(),
  });
});

/* ── filesystem ──────────────────────────────────────────────────────── */

/**
 * List directories at `path` (defaults to the user's home). Used by the
 * mobile cwd picker. We return only directories (not files) because the
 * picker exists to choose a working directory for a new pi session.
 *
 * Personal-use bridge behind Tailscale → no path sandboxing. If we ever
 * expose this publicly we'd want to bound it to a configured root.
 */
app.get("/fs/ls", (c) => {
  const raw = c.req.query("path");
  const showHidden = c.req.query("hidden") === "1";

  let target: string;
  try {
    // Default the mobile picker to the agent workspace area rather than the
    // service HOME. HOME also contains pi auth/session internals; the useful
    // place for humans is where repos are cloned.
    target = raw ? resolvePath(raw) : resolvePath(process.env.PI_WORKSPACES_DIR ?? homedir());
  } catch {
    return c.json({ error: "invalid_path" }, 400);
  }

  let entries: string[];
  try {
    entries = readdirSync(target);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.json({ error: "not_found" }, 404);
    if (code === "EACCES" || code === "EPERM")
      return c.json({ error: "forbidden" }, 403);
    return c.json({ error: "ls_failed", detail: String(e) }, 500);
  }

  const dirs: Array<{ name: string; hidden: boolean }> = [];
  for (const name of entries) {
    if (!showHidden && name.startsWith(".")) continue;
    try {
      const st = statSync(`${target}${PATH_SEP}${name}`);
      if (st.isDirectory()) {
        dirs.push({ name, hidden: name.startsWith(".") });
      }
    } catch {
      // Skip entries we can't stat (broken symlinks, perms, etc.)
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  // Parent path — null at the filesystem root.
  const parent = (() => {
    const p = dirname(target);
    return p === target ? null : p;
  })();

  return c.json({ path: target, parent, home: homedir(), entries: dirs });
});

/* ── boot ────────────────────────────────────────────────────────────── */

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const sessionId = url.searchParams.get("session");
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  if (!sessionId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const bindings: WsBindings = { sessionId, cursor };
  wss.handleUpgrade(request, socket, head, (ws) => {
    onConnection(ws, bindings);
  });
});

console.log(`pi-bridge listening on http://${HOST}:${PORT}  ${USING_MOCK ? "(mock pi)" : "(live pi)"}`);
console.log(`   db   :  ${DB_PATH}`);
console.log(`   REST :  GET    /healthz`);
console.log(`           GET    /sessions`);
console.log(`           POST   /sessions       { cwd, title?, branch? }`);
console.log(`           GET    /sessions/:id`);
console.log(`           PATCH  /sessions/:id   { title?, archived? }`);
console.log(`           DELETE /sessions/:id`);
console.log(`   WS   :  /ws?session=:id&cursor=:n`);

/* ── graceful shutdown ───────────────────────────────────────────────── */

const shutdown = async () => {
  console.log("shutting down…");
  wss.close();
  server.close();
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
