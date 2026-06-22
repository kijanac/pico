import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import type { FsListing } from "@pico/protocol/rpc";
import { WORKSPACES_DIR } from "./config.ts";

const workspaceRoot = () => resolvePath(WORKSPACES_DIR);

const isInsideRoot = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export function listFs(path?: string, opts?: { showHidden?: boolean }): FsListing {
  const showHidden = opts?.showHidden ?? false;

  let root: string;
  let target: string;
  try {
    root = realpathSync(workspaceRoot());
    target = path ? resolvePath(path) : root;
    target = realpathSync(target);
  } catch {
    throw new Error("not_found");
  }

  if (!isInsideRoot(root, target)) {
    throw new Error("outside_workspace_root");
  }

  let entries: string[];
  try {
    entries = readdirSync(target);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("not_found");
    if (code === "EACCES" || code === "EPERM") throw new Error("forbidden");
    throw new Error(`ls_failed: ${String(e)}`);
  }

  const dirs: Array<{ name: string; hidden: boolean }> = [];
  for (const name of entries) {
    if (!showHidden && name.startsWith(".")) continue;
    try {
      const child = join(target, name);
      const childReal = realpathSync(child);
      if (!isInsideRoot(root, childReal)) continue;

      const st = statSync(childReal);
      if (st.isDirectory()) {
        dirs.push({ name, hidden: name.startsWith(".") });
      }
    } catch {
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const parent = (() => {
    if (target === root) return null;
    const p = dirname(target);
    return isInsideRoot(root, p) ? p : null;
  })();

  return { path: target, parent, home: root, entries: dirs };
}
