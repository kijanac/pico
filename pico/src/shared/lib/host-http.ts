// Non-RPC host HTTP: the unauthenticated health probe and the HTML export URL
// (opened directly by the browser). RPC goes through rpc-client.ts; the live
// session stream through the WS-RPC client (PicoSessionClient).
import { FetchHttpClient, HttpClient } from "@effect/platform";
import { Data, Effect } from "effect";

// Host reachability, split by failure mode so callers don't over-claim a cause:
//   healthy     – 2xx
//   starting    – timed out or non-2xx (host booting, or a cold tailnet path
//                 warming up — what a single short probe false-negatives on)
//   unreachable – transport failure (DNS/refused/TLS): a genuine "can't connect"
export type HostReachability = "healthy" | "starting" | "unreachable";

// Carries a non-healthy verdict across the run boundary as a typed value —
// discriminated by `instanceof`, not sniffed off an `unknown`.
export class HostNotReady extends Data.TaggedError("HostNotReady")<{
  readonly reachability: "starting" | "unreachable";
}> {}

// Patient, retried probe. HttpClient's typed RequestError/ResponseError split +
// Effect.timeout give the three buckets; it provides its own client layer, so it
// composes into any caller without adding requirements.
export const healthcheckHost = (url: string): Effect.Effect<HostReachability> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    yield* HttpClient.filterStatusOk(client).get(`${url.trim()}/healthz`);
  }).pipe(
    Effect.timeout("4 seconds"),
    Effect.retry({ times: 1 }),
    Effect.as("healthy" as const),
    Effect.catchTags({
      RequestError: () => Effect.succeed("unreachable" as const),
      ResponseError: () => Effect.succeed("starting" as const),
      TimeoutException: () => Effect.succeed("starting" as const),
    }),
    Effect.provide(FetchHttpClient.layer),
  );

export const sessionExportHtmlUrl = (baseUrl: string, sessionId: string): string =>
  `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/export.html`;
