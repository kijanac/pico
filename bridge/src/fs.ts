import { readdirSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath, sep as PATH_SEP } from "node:path";
import { homedir } from "node:os";
import type { Context } from "hono";

/**
 * List directories at `path` (defaults to the user's home). Used by the
 * mobile cwd picker. We return only directories (not files) because the
 * picker exists to choose a working directory for a new pi session.
 *
 * Personal-use bridge behind Tailscale → no path sandboxing. If we ever
 * expose this publicly we'd want to bound it to a configured root.
 */
export function handleFsLs(c: Context) {
  const raw = c.req.query("path");
  const showHidden = c.req.query("hidden") === "1";

  let target: string;
  try {
    // Default the mobile picker to the agent workspace area rather than the
    // service HOME. HOME also contains pi auth/session internals; the useful
    // place for humans is where repos are cloned.
    target = raw
      ? resolvePath(raw)
      : resolvePath(process.env.PI_WORKSPACES_DIR ?? homedir());
  } catch {
    return c.json({ error: "invalid_path" }, 400);
  }

  let entries: string[];
  try {
    entries = readdirSync(target);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.json({ error: "not_found" }, 404);
    if (code === "EACCES" || code === "EPERM") {
      return c.json({ error: "forbidden" }, 403);
    }
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
}
