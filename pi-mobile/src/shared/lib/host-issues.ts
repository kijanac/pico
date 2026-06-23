import { Effect, Either } from "effect";
import { isHostErrorCode, type HostErrorCode } from "@pico/protocol";
import { HostError } from "@pico/protocol/rpc";
import { healthcheckHostUrl } from "@/features/settings/api";
import { PicoClient, rpc } from "@/shared/lib/rpc-client";

export type HostIssueKind =
  | "host-unreachable"
  | "tailscale-not-connected"
  | "pairing-token-invalid"
  | "host-claimed"
  | "provider-auth-missing"
  | "host-unclaimed"
  | "generic";

export interface HostIssue {
  readonly kind: HostIssueKind;
  readonly title: string;
  readonly message: string;
  readonly steps: readonly string[];
}

export interface HostIssueOptions {
  readonly url?: string;
}

export function hostErrorCodeOf(error: unknown): HostErrorCode | undefined {
  if (error instanceof HostError) return error.code;
  if (isHostErrorCode(error)) return error;
  if (typeof error === "object" && error !== null && "hostErrorCode" in error) {
    const code = (error as { hostErrorCode: unknown }).hostErrorCode;
    if (isHostErrorCode(code)) return code;
  }
  return undefined;
}

function genericIssue(error: unknown): HostIssue {
  return {
    kind: "generic",
    title: "Pico host request failed",
    message: errorText(error) || "The Pico host returned an unexpected error.",
    steps: [
      "Try again after checking that the host is running.",
      "Run `pico doctor` on the host for a more detailed diagnosis.",
    ],
  };
}

export function classifyHostIssue(error: unknown, options: HostIssueOptions = {}): HostIssue {
  const code = hostErrorCodeOf(error);
  return code ? hostIssueForCode(code, options) : genericIssue(error);
}

export function classifyHostFailure(
  error: unknown,
  options: HostIssueOptions = {},
): Effect.Effect<HostIssue, never, PicoClient> {
  const code = hostErrorCodeOf(error);
  if (code) return Effect.succeed(hostIssueForCode(code, options));
  const url = options.url;
  if (!url) return Effect.succeed(genericIssue(error));
  return Effect.gen(function* () {
    const reachable = yield* Effect.promise(() => healthcheckHostUrl(url).catch(() => false));
    if (!reachable) return hostIssueForCode("host_unreachable", options);
    const probe = yield* Effect.either(rpc((c) => c.system.identity()));
    if (Either.isLeft(probe)) {
      const probeCode = hostErrorCodeOf(probe.left);
      if (probeCode) return hostIssueForCode(probeCode, options);
    }
    return genericIssue(error);
  });
}

export function providerAuthMissingIssue(): HostIssue {
  return hostIssueForCode("provider_auth_missing");
}

export function hostIssueSummary(error: unknown, options: HostIssueOptions = {}): string {
  const issue = classifyHostIssue(error, options);
  return `${issue.title}: ${issue.message}`;
}

export function hostIssueForCode(code: HostErrorCode, options: HostIssueOptions = {}): HostIssue {
  const url = options.url?.trim();
  const tailnetUrl = !!url && url.includes(".ts.net");

  switch (code) {
    case "pairing_link_missing_url":
      return {
        kind: "generic",
        title: "pairing link is incomplete",
        message: "This pairing link is missing the Pico host URL.",
        steps: [
          "Run `pico pair` on the host again and scan the full QR code.",
          "If entering details manually, paste the host URL printed next to the QR code.",
        ],
      };

    case "invalid_pairing_token":
      return {
        kind: "pairing-token-invalid",
        title: "pairing token invalid or expired",
        message: "The Pico host rejected this one-time pairing token.",
        steps: [
          "On the host, run `pico pair` again to print a fresh QR/link.",
          "If a host is already running, run `pico pair-code --rotate` and use the newest token.",
          "Pairing tokens only protect the first claim; after claim, your Tailscale login is the owner identity.",
        ],
      };

    case "missing_tailscale_identity":
      return {
        kind: "tailscale-not-connected",
        title: "Tailscale identity missing",
        message: "The host answered, but Tailscale did not attach your user identity.",
        steps: [
          "Open the Tailscale app on this phone and make sure it is connected.",
          "Use the `https://…ts.net` URL printed by `pico pair`, not a localhost or raw IP URL.",
          "On the host, run `pico status` and confirm Tailscale Serve is forwarding to the Pico host port.",
        ],
      };

    case "tailscale_user_not_pico_host_owner":
      return {
        kind: "host-claimed",
        title: "claimed by another Tailscale user",
        message: "This Pico host already has a different owner identity.",
        steps: [
          "Switch this phone to the Tailscale account that claimed the host.",
          "Or reset/reinstall the host if this machine should be claimed by a new owner.",
        ],
      };

    case "pico_host_already_claimed":
      return {
        kind: "host-claimed",
        title: "Pico host already claimed",
        message: "This host has already completed first-time pairing.",
        steps: [
          "Connect with the same Tailscale login that originally claimed it.",
          "If you are moving ownership, reset the host owner database or reinstall the host.",
        ],
      };

    case "pico_host_unclaimed":
      return {
        kind: "host-unclaimed",
        title: "Pico host is not claimed yet",
        message: "The host is reachable but has not accepted its first owner claim.",
        steps: [
          "Run `pico pair` on the host and scan the QR code again.",
          "If entering details manually, include both the host URL and pairing token.",
        ],
      };

    case "provider_auth_missing":
      return {
        kind: "provider-auth-missing",
        title: "provider auth missing",
        message: "Pi is reachable, but no model provider is signed in or configured yet.",
        steps: [
          "Open Providers and sign in to at least one provider, or save an API key.",
          "You can also configure providers on the host with normal Pi auth/settings.",
          "After provider auth is configured, new sessions can use models from that provider.",
        ],
      };

    case "host_unreachable":
      return {
        kind: tailnetUrl ? "tailscale-not-connected" : "host-unreachable",
        title: tailnetUrl ? "Tailscale not connected" : "host unreachable",
        message: tailnetUrl
          ? "This phone can't reach the Pico host over your tailnet."
          : "This phone can't reach the Pico host.",
        steps: [
          tailnetUrl
            ? "Open Tailscale on this phone and confirm it is connected to the same tailnet as the host."
            : "Check that the host URL is correct, including `https://` or `http://`.",
          "On the host, run `pico status` to confirm the local host is healthy.",
          tailnetUrl
            ? "Confirm Tailscale Serve is enabled and points to the Pico host port."
            : "If this is a phone, prefer the `https://…ts.net` URL from `pico pair`; `localhost` only works on the host itself.",
        ],
      };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}
