import { PiClientLive } from "./pi.ts";
import { PiClientMock } from "./pi-mock.ts";

/** Pick the impl based on $PI_USE_MOCK. */
export const PiClientFromEnv =
  process.env.PI_USE_MOCK === "1" ? PiClientMock : PiClientLive;
