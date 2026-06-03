import { PiClientLive } from "./pi.ts";

const ALLOW_UNSAFE_TEST_CLIENT = process.env.PI_ALLOW_UNSAFE_TEST_CLIENT === "1";

function assertTestClientAllowed(name: string): void {
  if (process.env.NODE_ENV !== "production" || ALLOW_UNSAFE_TEST_CLIENT) return;
  throw new Error(
    `${name} is disabled in production. ` +
      "Unset the test-client env var, or set PI_ALLOW_UNSAFE_TEST_CLIENT=1 intentionally.",
  );
}

async function selectPiClientLayer() {
  if (process.env.PI_USE_MOCK === "1") {
    assertTestClientAllowed("PI_USE_MOCK");
    const { PiClientMock } = await import("./pi-mock.ts");
    return PiClientMock;
  }

  return PiClientLive;
}

export const PiClientFromEnv = await selectPiClientLayer();
