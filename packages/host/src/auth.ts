import type * as Headers from "@effect/platform/Headers";
import type { HostErrorCode } from "@pico/protocol";
import { HOST_INSECURE_NO_AUTH, OWNER_LOGIN } from "./config.ts";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: HostErrorCode };

// SECURITY INVARIANT: identity comes solely from the `tailscale-user-login`
// header, which is trustworthy only because (1) the server binds loopback
// (host.ts), so the sole ingress is Tailscale Serve, and (2) `tailscale serve`
// strips client-supplied `Tailscale-*` headers and injects its own. Both must
// hold — never bind this process to a non-loopback host, and never front it
// with a proxy that forwards client `Tailscale-*` headers, or callers can
// spoof any identity.
export function authorizeHeaders(headers: Headers.Headers): AuthResult {
  if (HOST_INSECURE_NO_AUTH) return { ok: true };

  const login = headers["tailscale-user-login"]?.trim().toLowerCase();
  if (!login) return { ok: false, status: 401, error: "missing_tailscale_identity" };
  if (login !== OWNER_LOGIN) return { ok: false, status: 403, error: "tailscale_user_not_pico_host_owner" };
  return { ok: true };
}
