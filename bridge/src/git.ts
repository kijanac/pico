import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect } from "effect";
import { PiError } from "./pi.ts";

const execFileAsync = promisify(execFile);

export type GitBranchInfo =
  | { kind: "local"; name: string; current: boolean }
  | { kind: "remote"; name: string; remote: string };

export interface GitBranchesResult {
  isRepo: boolean;
  root?: string;
  current?: string;
  branches: GitBranchInfo[];
}

export interface GitWorktree {
  repoRoot: string;
  worktreePath: string;
  branch: string;
}

const git = async (cwd: string, args: string[]) => {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: 1024 * 1024 * 4,
  });
  return String(stdout).trimEnd();
};

const slug = (value: string) =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "repo";

const localNameForRemote = (name: string) => name.replace(/^[^/]+\//, "");

export const listGitBranches = (cwd: string): Effect.Effect<GitBranchesResult, PiError> =>
  Effect.tryPromise({
    try: async () => {
      let root: string;
      try {
        root = await git(cwd, ["rev-parse", "--show-toplevel"]);
      } catch {
        return { isRepo: false, branches: [] };
      }

      const current = await git(root, ["branch", "--show-current"]).catch(() => "");
      const lines = (await git(root, [
        "for-each-ref",
        "--format=%(refname:short)%00%(HEAD)%00%(upstream:short)",
        "refs/heads",
        "refs/remotes",
      ])).split("\n").filter(Boolean);

      const seen = new Set<string>();
      const branches: GitBranchInfo[] = [];
      for (const line of lines) {
        const [name, head] = line.split("\0");
        if (!name || name.endsWith("/HEAD") || seen.has(name)) continue;
        seen.add(name);
        // refs/remotes and refs/heads are both emitted as short names; detect remotes by asking show-ref prefix shape.
        const isRemote = await git(root, ["show-ref", "--verify", `refs/remotes/${name}`]).then(() => true, () => false);
        if (isRemote) {
          branches.push({ kind: "remote", name, remote: name.split("/")[0] });
        } else {
          branches.push({ kind: "local", name, current: head === "*" || name === current });
        }
      }

      branches.sort((a, b) => Number(b.kind === "local" && b.current) - Number(a.kind === "local" && a.current) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
      return { isRepo: true, root, current: current || undefined, branches };
    },
    catch: (e) => new PiError(`git branches failed: ${String(e)}`),
  });

export const createSessionWorktree = (opts: { cwd: string; branch?: string }): Effect.Effect<GitWorktree | undefined, PiError> =>
  Effect.tryPromise({
    try: async () => {
      const info = await Effect.runPromise(listGitBranches(opts.cwd));
      if (!info.isRepo || !info.root) {
        if (opts.branch) throw new Error("selected directory is not inside a git repository");
        return undefined;
      }
      const branch = opts.branch || info.current;
      if (!branch) throw new Error("repository is in detached HEAD; choose a branch");

      const selected = info.branches.find((b) => b.name === branch);
      if (!selected) throw new Error(`branch not found: ${branch}`);

      const root = info.root;
      const worktreePath = join(homedir(), ".pi-mobile", "worktrees", `${slug(basename(root))}-${randomUUID().slice(0, 8)}`);
      await mkdir(join(homedir(), ".pi-mobile", "worktrees"), { recursive: true });

      if (selected.kind === "remote") {
        const localName = localNameForRemote(branch);
        if (info.branches.some((b) => b.kind === "local" && b.name === localName)) {
          await git(root, ["worktree", "add", "-f", worktreePath, localName]);
          return { repoRoot: root, worktreePath, branch: localName };
        }
        await git(root, ["worktree", "add", "--track", "-b", localName, worktreePath, branch]);
        return { repoRoot: root, worktreePath, branch: localName };
      }

      await git(root, ["worktree", "add", "-f", worktreePath, branch]);
      return { repoRoot: root, worktreePath, branch };
    },
    catch: (e) => new PiError(`create worktree failed: ${String(e)}`),
  });

export const removeSessionWorktree = (repoRoot: string, worktreeCwd: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      await execFileAsync("git", ["-C", repoRoot, "worktree", "remove", worktreeCwd]);
    } catch {
      // If git refuses because the tree is dirty or metadata is gone, leave files in place.
      return;
    }
    await rm(worktreeCwd, { recursive: true, force: true }).catch(() => undefined);
  });
