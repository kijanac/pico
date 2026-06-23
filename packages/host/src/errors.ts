import { Data } from "effect";
import type { HostErrorCode } from "@pico/protocol";

// Internal host error carrying a wire error code, raised during owner claim and
// mapped to the protocol HostError at the RPC boundary. Named to avoid colliding
// with @pico/protocol's HostError.
export class HostClaimError extends Data.TaggedError("HostClaimError")<{
  readonly hostErrorCode: HostErrorCode;
}> {}

export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  readonly id: string;
}> {}
