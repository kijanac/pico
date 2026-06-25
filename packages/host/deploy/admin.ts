#!/usr/bin/env tsx
// Build-time only: emit the signed release manifest for package-pico-host.sh.
// All runtime updater logic now lives in the compiled host-update.mjs.
import {
  MIN_MOBILE_VERSION,
  PROTOCOL_VERSION,
  RECOMMENDED_MOBILE_VERSION,
} from "../../protocol/src/version.ts";

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
        artifact: { name: artifactName, sha256 },
      },
      null,
      2,
    )}\n`,
  );
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "package-release") packageRelease(args);
  else throw new Error("usage: admin.ts package-release <version> <artifact-name> <sha256>");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
