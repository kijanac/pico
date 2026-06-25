import { Data } from "effect";

export type DiagnosticLevel = "ok" | "warn" | "fail";

export type DiagnosticCode =
  | "node_version_too_old"
  | "missing_pi_cli"
  | "pi_model_registry_failed"
  | "missing_tailscale_cli"
  | "tailscale_not_running"
  | "tailscale_serve_missing"
  | "tailscale_serve_failed"
  | "tailscale_identity_unavailable"
  | "host_port_in_use"
  | "host_health_timeout"
  | "host_start_failed"
  | "local_admin_unavailable"
  | "path_missing"
  | "path_not_writable"
  | "provider_auth_missing"
  | "invalid_service_command";

export interface Diagnostic {
  readonly level: DiagnosticLevel;
  readonly label: string;
  readonly detail?: string;
  readonly fix?: string;
  readonly code?: DiagnosticCode;
}

export class PicoSetupError extends Data.TaggedError("PicoSetupError")<{
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly detail?: string;
  readonly fix?: string;
  readonly cause?: unknown;
}> {}

export function setupErrorMessage(error: unknown): string {
  if (error instanceof PicoSetupError) return `${error.message}${error.fix ? `\n${error.fix}` : ""}`;
  return error instanceof Error ? error.message : String(error);
}
