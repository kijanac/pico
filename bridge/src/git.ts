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
  baseBranch: string;
  baseRef: string;
  sessionBranch: string;
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

const sessionBranchName = (baseBranch: string) =>
  `pi/session/${randomUUID().slice(0, 8)}-${slug(baseBranch)}`;

const sortBranches = (a: GitBranchInfo, b: GitBranchInfo) =>
  Number(b.kind === "local" && b.current) - Number(a.kind === "local" && a.current) ||
  a.kind.localeCompare(b.kind) ||
  a.name.localeCompare(b.name);

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
        "--format=%(refname)%00%(HEAD)",
        "refs/heads",
        "refs/remotes",
      ])).split("\n").filter(Boolean);

      const branches: GitBranchInfo[] = [];
      for (const line of lines) {
        const [ref, head] = line.split("\0");
        if (ref.startsWith("refs/heads/")) {
          const name = ref.slice("refs/heads/".length);
          branches.push({ kind: "local", name, current: head === "*" || name === current });
          continue;
        }

        if (ref.startsWith("refs/remotes/")) {
          const name = ref.slice("refs/remotes/".length);
          if (name.endsWith("/HEAD")) continue;
          branches.push({ kind: "remote", name, remote: name.split("/")[0] });
        }
      }

      branches.sort(sortBranches);
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

      const selectedBranch = opts.branch || info.current;
      if (!selectedBranch) throw new Error("repository is in detached HEAD; choose a branch");

      const selected = info.branches.find((b) => b.name === selectedBranch);
      if (!selected) throw new Error(`branch not found: ${selectedBranch}`);

      const repoRoot = info.root;
      const baseRef = selected.name;
      const baseBranch = selected.kind === "remote" ? localNameForRemote(selected.name) : selected.name;
      const sessionBranch = sessionBranchName(baseBranch);
      const worktreePath = join(homedir(), ".pi-mobile", "worktrees", `${slug(basename(repoRoot))}-${randomUUID().slice(0, 8)}`);

      await mkdir(join(homedir(), ".pi-mobile", "worktrees"), { recursive: true });
      await git(repoRoot, ["worktree", "add", "-b", sessionBranch, worktreePath, baseRef]);

      return { repoRoot, worktreePath, baseBranch, baseRef, sessionBranch };
    },
    catch: (e) => new PiError(`create worktree failed: ${String(e)}`),
  });

export const removeSessionWorktree = (opts: {
  repoRoot: string;
  worktreePath: string;
  sessionBranch: string;
}): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      await execFileAsync("git", ["-C", opts.repoRoot, "worktree", "remove", opts.worktreePath]);
    } catch {
      // If git refuses because the tree is dirty or metadata is gone, leave files and branch in place.
      return;
    }

    await execFileAsync("git", ["-C", opts.repoRoot, "branch", "-d", opts.sessionBranch]).catch(() => undefined);
    await rm(opts.worktreePath, { recursive: true, force: true }).catch(() => undefined);
  });
