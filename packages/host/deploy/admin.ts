#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { Schema } from "effect";
import {
  MIN_MOBILE_VERSION,
  PROTOCOL_VERSION,
  RECOMMENDED_MOBILE_VERSION,
} from "../../protocol/src/version.ts";

const Asset = Schema.Struct({
  name: Schema.String,
  browser_download_url: Schema.String,
});

const Release = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(Asset),
});
type Release = typeof Release.Type;

const Manifest = Schema.Struct({
  version: Schema.String,
  artifact: Schema.Struct({
    name: Schema.String,
    sha256: Schema.String,
  }),
});

const UpdateStateSchema = Schema.Struct({
  currentVersion: Schema.optional(Schema.String),
  lastSeenVersion: Schema.optional(Schema.String),
  lastSeenAt: Schema.optional(Schema.Number),
  updatedAt: Schema.optional(Schema.Number),
  failedAt: Schema.optional(Schema.Number),
  failure: Schema.optional(Schema.Struct({
    version: Schema.String,
    reason: Schema.String,
    at: Schema.Number,
  })),
});

// Mutable: state-set mutates decoded state in place; schema's inferred type is readonly.
interface UpdateState {
  currentVersion?: string;
  lastSeenVersion?: string;
  lastSeenAt?: number;
  updatedAt?: number;
  failedAt?: number;
  failure?: { version: string; reason: string; at: number };
}

function parseFile<A, I>(schema: Schema.Schema<A, I>, path: string, label: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`invalid ${label} JSON at ${path}: ${String(error)}`);
  }
}

function readUpdateState(path: string): UpdateState {
  try {
    return Schema.decodeUnknownSync(UpdateStateSchema)(JSON.parse(readFileSync(path, "utf8"))) as UpdateState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`invalid update state JSON at ${path}: ${String(error)}`);
  }
}

function assetUrl(release: Release, name: string): string {
  const asset = release.assets.find((entry) => entry.name === name);
  if (!asset) throw new Error(`${name} asset missing`);
  return asset.browser_download_url;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff =
      (Number.isFinite(pa[i]) ? pa[i] : 0) -
      (Number.isFinite(pb[i]) ? pb[i] : 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function emitLines(values: string[]): void {
  process.stdout.write(`${values.join("\n")}\n`);
}

function packageRelease(args: string[]): void {
  const [version, artifactName, sha256] = args;
  if (!version || !artifactName || !sha256) {
    throw new Error("usage: admin.ts package-release <version> <artifact-name> <sha256>");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        version,
        protocolVersion: PROTOCOL_VERSION,
        minMobileVersion: MIN_MOBILE_VERSION,
        recommendedMobileVersion: RECOMMENDED_MOBILE_VERSION,
        artifact: {
          name: artifactName,
          sha256,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function updateRelease(args: string[]): void {
  const [releasePath, currentVersion, lastSeenVersion] = args;
  if (!releasePath || !currentVersion || !lastSeenVersion) {
    throw new Error("usage: admin.ts update-release <release.json> <current-version> <last-seen-version>");
  }

  const release = parseFile(Release, releasePath, "release");
  const version = release.tag_name.replace(/^v/, "");
  if (!version) throw new Error("release tag_name did not contain a version");

  if (compareVersions(version, currentVersion) <= 0) {
    emitLines(["no_update", version]);
    return;
  }
  if (compareVersions(lastSeenVersion, version) > 0) {
    throw new Error(`refusing rollback from last seen ${lastSeenVersion} to ${version}`);
  }

  emitLines([
    "update",
    version,
    assetUrl(release, "pico-host-release.json"),
    assetUrl(release, "pico-host-release.json.sig"),
  ]);
}

function stateLastSeen(args: string[]): void {
  const [statePath, currentVersion] = args;
  if (!statePath || !currentVersion) {
    throw new Error("usage: admin.ts state-last-seen <state.json> <current-version>");
  }
  process.stdout.write(`${readUpdateState(statePath).lastSeenVersion ?? currentVersion}\n`);
}

function stateSet(args: string[]): void {
  const [statePath, version, status, reason] = args;
  if (!statePath || !version || !status) {
    throw new Error("usage: admin.ts state-set <state.json> <version> <seen|failed|updated> [reason]");
  }

  const state = readUpdateState(statePath);
  const now = Date.now();
  if (status === "seen") {
    state.lastSeenVersion = version;
    state.lastSeenAt = now;
  } else if (status === "failed") {
    state.failedAt = now;
    state.failure = { version, reason: reason ?? "unknown", at: now };
  } else if (status === "updated") {
    state.currentVersion = version;
    state.lastSeenVersion = version;
    state.updatedAt = now;
    delete state.failure;
    delete state.failedAt;
  } else {
    throw new Error(`unknown update state status: ${status}`);
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function updateManifest(args: string[]): void {
  const [releasePath, manifestPath, expectedVersion] = args;
  if (!releasePath || !manifestPath || !expectedVersion) {
    throw new Error("usage: admin.ts update-manifest <release.json> <pico-host-release.json> <expected-version>");
  }

  const release = parseFile(Release, releasePath, "release");
  const manifest = parseFile(Manifest, manifestPath, "manifest");
  if (manifest.version !== expectedVersion) {
    throw new Error(`manifest version ${manifest.version} does not match release ${expectedVersion}`);
  }

  emitLines([
    manifest.version,
    manifest.artifact.name,
    manifest.artifact.sha256,
    assetUrl(release, manifest.artifact.name),
  ]);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "package-release") packageRelease(args);
  else if (command === "update-release") updateRelease(args);
  else if (command === "update-manifest") updateManifest(args);
  else if (command === "state-last-seen") stateLastSeen(args);
  else if (command === "state-set") stateSet(args);
  else throw new Error("usage: admin.ts <package-release|update-release|update-manifest|state-last-seen|state-set> ...");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
