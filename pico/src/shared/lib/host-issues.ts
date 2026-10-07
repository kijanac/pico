import { Effect } from "effect";
import { isHostErrorCode, type HostErrorCode } from "@pico/protocol";
import { healthcheckHost } from "@/shared/lib/host-http";

export type HostIssueKind =
  | "host-unreachable"
  | "host-starting"
  | "tailscale-not-connected"
  | "not-owner"
  | "provider-auth-missing"
  | "generic";

export interface HostIssue {
  readonly kind: HostIssueKind;
  readonly title: string;
  readonly message: string;
  readonly steps: readonly string[];
}

function hostErrorCodeOf(error: unknown): HostErrorCode | undefined {
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
      "On the host, `journalctl --user -u pico` shows the host's log.",
    ],
  };
}

function hostStartingIssue(): HostIssue {
  return {
    kind: "host-starting",
    title: "host isn't ready yet",
    message: "The host isn't responding promptly — it may be starting up, or a fresh tailnet connection is still warming up.",
    steps: [
      "Wait a few seconds and try again; a cold tailnet path can take a moment to connect.",
      "If it persists, run `systemctl --user status pico` on the host to confirm it is running.",
    ],
  };
}

// Map a non-healthy reachability to an issue. "unreachable" is a genuine transport
// failure (so the Tailscale/host-unreachable copy is warranted); "starting" is a
// slow/booting host that we must NOT mislabel as "Tailscale not connected".
function reachabilityIssue(reachability: "starting" | "unreachable"): HostIssue {
  return reachability === "unreachable" ? hostIssueForCode("host_unreachable") : hostStartingIssue();
}

export function classifyHostIssue(error: unknown): HostIssue {
  const code = hostErrorCodeOf(error);
  return code ? hostIssueForCode(code) : genericIssue(error);
}

export function classifyHostFailure(error: unknown): Effect.Effect<HostIssue> {
  const code = hostErrorCodeOf(error);
  if (code) return Effect.succeed(hostIssueForCode(code));
  return Effect.gen(function* () {
    const reachability = yield* healthcheckHost;
    return reachability === "healthy" ? genericIssue(error) : reachabilityIssue(reachability);
  });
}

export function providerAuthMissingIssue(): HostIssue {
  return hostIssueForCode("provider_auth_missing");
}

// What to show for a failure: at once, from the error itself; then, for an
// untyped failure, `refine` gets a sharper answer when the host's health is
// known (starting, or unreachable). The probe can take seconds on a bad
// network, so nothing waits for it; callers drop a refinement that arrives
// after something newer.
export function diagnoseHostFailure(error: unknown, refine: (issue: HostIssue) => void): HostIssue {
  if (!hostErrorCodeOf(error)) void Effect.runPromise(classifyHostFailure(error)).then(refine);
  return classifyHostIssue(error);
}

export function issueText(issue: HostIssue): string {
  return `${issue.title}: ${issue.message}`;
}

export function hostIssueSummary(error: unknown): string {
  return issueText(classifyHostIssue(error));
}

export function hostIssueForCode(code: HostErrorCode): HostIssue {
  const tailnetUrl = window.location.hostname.endsWith(".ts.net");

  switch (code) {
    case "missing_tailscale_identity":
      return {
        kind: "tailscale-not-connected",
        title: "Tailscale identity missing",
        message: "The host answered, but Tailscale did not attach your user identity.",
        steps: [
          "Open the Tailscale app on this phone and make sure it is connected.",
          "Open Pico through its `https://…ts.net` URL, not a localhost or raw IP URL.",
          "On the host, `tailscale serve status` should show the Pico host port.",
        ],
      };

    case "tailscale_user_not_pico_host_owner":
      return {
        kind: "not-owner",
        title: "not this host's owner",
        message: "This Pico host only accepts the Tailscale login set as PICO_OWNER.",
        steps: [
          "Switch this phone to the Tailscale account that owns the host.",
          "Or change PICO_OWNER in the host's systemd unit and restart it.",
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
            : "Check that this device can reach the host.",
          "On the host, run `systemctl --user status pico` to confirm it is running.",
          tailnetUrl
            ? "Confirm Tailscale Serve is enabled and points to the Pico host port."
            : "From a phone, use the host's `https://…ts.net` URL; `localhost` only works on the host itself.",
        ],
      };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}
