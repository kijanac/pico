import { Schema } from "effect";

export const HostErrorCodeSchema = Schema.Literal(
  "host_unreachable",
  "missing_tailscale_identity",
  "tailscale_user_not_pico_host_owner",
  "provider_auth_missing",
);
export type HostErrorCode = typeof HostErrorCodeSchema.Type;

export const isHostErrorCode = Schema.is(HostErrorCodeSchema);
