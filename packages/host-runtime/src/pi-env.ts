import { ALLOW_UNSAFE_TEST_CLIENT, IS_PRODUCTION, USE_MOCK } from "./config.ts";
import { PiClientLive } from "./pi.ts";

function assertTestClientAllowed(name: string): void {
  if (!IS_PRODUCTION || ALLOW_UNSAFE_TEST_CLIENT) return;
  throw new Error(
    `${name} is disabled in production. ` +
      "Unset the test-client env var, or set PI_ALLOW_UNSAFE_TEST_CLIENT=1 intentionally.",
  );
}

async function selectPiClientLayer() {
  if (USE_MOCK) {
    assertTestClientAllowed("PI_USE_MOCK");
    const { PiClientMock } = await import("./pi-mock.ts");
    return PiClientMock;
  }

  return PiClientLive;
}

export const PiClientFromEnv = await selectPiClientLayer();
