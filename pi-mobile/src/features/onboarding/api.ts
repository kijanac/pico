import { Effect } from "effect";
import { createHostClient } from "@/shared/lib/host-client";
import { rpc } from "@/shared/lib/rpc-client";

export function healthcheckHostUrl(url: string): Promise<boolean> {
  return createHostClient(url).healthcheck();
}

// Claim the host with the caller's Tailscale identity if it isn't already
// claimed. Run against a specific host via runAt(url, claimReachableHost()).
export const claimReachableHost = (token?: string) =>
  rpc((c) => c.system.identity()).pipe(
    Effect.flatMap((identity) =>
      identity.claimed ? Effect.void : Effect.asVoid(rpc((c) => c.system.claim(token ? { token } : {}))),
    ),
  );
