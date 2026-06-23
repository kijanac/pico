#!/usr/bin/env node
// Bump the workspace version everywhere it lives, in one shot.
//
// Usage:
//   node scripts/bump-version.mjs <x.y.z | patch | minor | major> [--min]
//
//   --min  also raise MIN_MOBILE_VERSION to the new version (forces older
//          mobile clients to update before they can connect).
//
// Files touched:
//   package.json, packages/host/package.json, packages/cli/package.json,
//   packages/protocol/package.json, pi-mobile/package.json -> "version"
//   packages/protocol/src/version.ts -> PRODUCT_VERSION (+ MIN_MOBILE_VERSION with --min)
//   pi-mobile/ios/App/App.xcodeproj/project.pbxproj -> MARKETING_VERSION
//     (CI overrides this at build time; synced so local Xcode builds match)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const bumpMin = args.includes("--min");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("usage: bump-version.mjs <x.y.z | patch | minor | major> [--min]");
  process.exit(1);
}

const rootPkgPath = join(ROOT, "package.json");
const current = JSON.parse(readFileSync(rootPkgPath, "utf8")).version;

function nextVersion(current, target) {
  if (/^\d+\.\d+\.\d+$/.test(target)) return target;
  const [major, minor, patch] = current.split(".").map(Number);
  if (target === "patch") return `${major}.${minor}.${patch + 1}`;
  if (target === "minor") return `${major}.${minor + 1}.0`;
  if (target === "major") return `${major + 1}.0.0`;
  console.error(`invalid version or bump kind: ${target}`);
  process.exit(1);
}

const next = nextVersion(current, target);

function rewrite(relPath, replace) {
  const path = join(ROOT, relPath);
  const before = readFileSync(path, "utf8");
  const after = replace(before);
  if (before === after) {
    console.error(`no change applied to ${relPath} — aborting (pattern drift?)`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`  ${relPath}`);
}

console.log(`bumping ${current} -> ${next}${bumpMin ? " (incl. MIN_MOBILE_VERSION)" : ""}`);

for (const pkg of [
  "package.json",
  "packages/host/package.json",
  "packages/cli/package.json",
  "packages/protocol/package.json",
  "pi-mobile/package.json",
]) {
  rewrite(pkg, (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
}

rewrite("packages/protocol/src/version.ts", (s) => {
  let out = s.replace(/(PRODUCT_VERSION = ")[^"]+(")/, `$1${next}$2`);
  if (bumpMin) out = out.replace(/(MIN_MOBILE_VERSION = ")[^"]+(")/, `$1${next}$2`);
  return out;
});

rewrite("pi-mobile/ios/App/App.xcodeproj/project.pbxproj", (s) =>
  s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${next};`),
);

console.log(`\ndone. release with:\n  git commit -am "Release ${next}" && git tag v${next} && git push && git push --tags`);
