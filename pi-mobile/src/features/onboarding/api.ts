import { Effect } from "effect";
import { settingsState } from "@/features/settings/settings.state.svelte";
import { healthcheckHostUrl } from "@/shared/lib/host-http";
import { rpc } from "@/shared/lib/rpc-client";

export { healthcheckHostUrl };

const claimReachableHost = (token?: string) =>
  rpc((c) => c.system.identity()).pipe(
    Effect.flatMap((identity) =>
      identity.claimed ? Effect.void : Effect.asVoid(rpc((c) => c.system.claim(token ? { token } : {}))),
    ),
  );

// Healthcheck, claim (skipped if already claimed) with the optional pairing
// token, then persist the URL — persisted only after a successful claim, so a
// failed attempt leaves no half-connected host saved. Run via
// runAt(url, connectAndClaimHost(url, token)).
export const connectAndClaimHost = (url: string, token?: string) =>
  Effect.gen(function* () {
    const reachable = yield* Effect.promise(() => healthcheckHostUrl(url));
    if (!reachable) return yield* Effect.fail({ hostErrorCode: "host_unreachable" as const });
    yield* claimReachableHost(token);
    yield* Effect.promise(() => settingsState.setHostUrl(url));
  });
