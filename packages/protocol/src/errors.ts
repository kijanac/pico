import { Schema } from "effect";

const HOST_ERROR_CODE_VALUES = [
  "host_unreachable",
  "missing_tailscale_identity",
  "invalid_pairing_token",
  "pico_host_already_claimed",
  "pico_host_unclaimed",
  "tailscale_user_not_pico_host_owner",
  "provider_auth_missing",
  "pairing_link_missing_url",
] as const;

export const HostErrorCodeSchema = Schema.Literal(...HOST_ERROR_CODE_VALUES);
export type HostErrorCode = typeof HostErrorCodeSchema.Type;

const HOST_ERROR_CODES = new Set<string>(HOST_ERROR_CODE_VALUES);

export interface HostErrorPayload {
  readonly hostErrorCode: HostErrorCode;
}

export function isHostErrorCode(value: unknown): value is HostErrorCode {
  return typeof value === "string" && HOST_ERROR_CODES.has(value);
}

export function hostErrorPayloadFromUnknown(value: unknown): HostErrorPayload | undefined {
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (isHostErrorCode(record.hostErrorCode)) return { hostErrorCode: record.hostErrorCode };

  const data = record.data;
  if (data && typeof data === "object" && isHostErrorCode((data as Record<string, unknown>).hostErrorCode)) {
    return { hostErrorCode: (data as Record<string, HostErrorCode>).hostErrorCode };
  }

  return undefined;
}
