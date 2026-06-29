import { Effect } from "effect";
import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
import { healthcheckHost, HostNotReady } from "@/shared/lib/host-http";
import { rpc } from "@/shared/lib/rpc-client";

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
    const reachability = yield* healthcheckHost(url);
    if (reachability !== "healthy") return yield* new HostNotReady({ reachability });
    yield* claimReachableHost(token);
    const info = yield* rpc((c) => c.system.info());
    yield* Effect.promise(() => hostRegistryState.addOrUpdateHost(url, info));
  });
