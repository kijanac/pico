#!/usr/bin/env node
// One-command release: preconditions -> bump -> changelog -> commit -> tag -> push.
//
// Usage: pnpm release <patch|minor|major> [--min] [--dry-run] [--yes]
//   --min      also raise MIN_MOBILE_VERSION (breaking protocol change)
//   --dry-run  bump + regenerate the changelog, print the plan, then revert
//   --yes      skip the confirmation prompt
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const level = args.find((a) => a === "patch" || a === "minor" || a === "major");
const withMin = args.includes("--min");
const dryRun = args.includes("--dry-run");
const skipConfirm = args.includes("--yes") || args.includes("-y");

const cap = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const loud = (cmd) => execSync(cmd, { stdio: "inherit" });
const die = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

if (!level) die("usage: pnpm release <patch|minor|major> [--min] [--dry-run] [--yes]");

// Releases come from a clean, up-to-date main — guards the wrong-branch slip.
if (cap("git rev-parse --abbrev-ref HEAD") !== "main") die("releases must be cut from main");
if (cap("git status --porcelain")) die("working tree is dirty; commit or stash first");
loud("git fetch origin main --quiet");
const [behind] = cap("git rev-list --left-right --count origin/main...HEAD").split(/\s+/).map(Number);
if (behind > 0) die(`local main is ${behind} commit(s) behind origin/main; pull first`);

// Bump versions, then regenerate the changelog with the new commits labelled as
// the tag (which doesn't exist yet, so --tag pre-labels the unreleased section).
loud(`node scripts/bump-version.mjs ${level}${withMin ? " --min" : ""}`);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
loud(`npx -y git-cliff@latest --config cliff.toml --tag ${tag} -o CHANGELOG.md`);

if (dryRun) {
  console.log(`\n[dry-run] would release ${tag}; reverting working-tree changes.`);
  loud("git checkout -- .");
  process.exit(0);
}

if (!skipConfirm) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (
    await rl.question(`\nRelease ${tag}? Commits, tags, and pushes — triggers TestFlight + host release. [y/N] `)
  ).trim().toLowerCase();
  rl.close();
  if (answer !== "y") {
    loud("git checkout -- .");
    die("aborted; reverted version + changelog changes");
  }
}

loud("git add -A");
loud(`git commit -m "Release ${version}"`);
loud(`git tag ${tag}`);
loud("git push origin main");
loud(`git push origin ${tag}`);
console.log(`\n✓ released ${tag}. watch it: gh run list`);
