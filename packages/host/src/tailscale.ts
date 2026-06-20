import { Effect } from "effect";
import { commandExists, run, runEffect, runOutput, runStderr, runStdout } from "./exec.ts";
import type { Diagnostic } from "./errors.ts";

export interface TailscaleStatus {
  readonly backendState?: string;
  readonly dnsName?: string;
  readonly hostName?: string;
  readonly ips: string[];
}

export interface TailscaleState {
  readonly installed: boolean;
  readonly running: boolean;
  readonly backendState?: string;
  readonly dnsName?: string;
  readonly hostName?: string;
  readonly ips: readonly string[];
  readonly serveTarget: string;
  readonly serveStatus?: string;
  readonly serveConfigured: boolean;
  readonly serveUrl?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export function hasTailscale(): boolean {
  return commandExists("tailscale", ["version"]);
}

export function tailscaleStatus(): TailscaleStatus | undefined {
  const result = run("tailscale", ["status", "--json"], { timeoutMs: 8_000 });
  if (result.status !== 0) return undefined;

  try {
    const status = JSON.parse(runStdout(result)) as {
      BackendState?: string;
      Self?: { DNSName?: string; HostName?: string; TailscaleIPs?: string[] };
      TailscaleIPs?: string[];
    };
    return {
      backendState: status.BackendState,
      dnsName: status.Self?.DNSName?.replace(/\.$/, "") || undefined,
      hostName: status.Self?.HostName,
      ips: status.Self?.TailscaleIPs ?? status.TailscaleIPs ?? [],
    };
  } catch {
    return undefined;
  }
}

export function tailscaleServeStatus(): string | undefined {
  const result = run("tailscale", ["serve", "status"], { timeoutMs: 8_000 });
  if (result.status !== 0) return undefined;
  return runOutput(result) || undefined;
}

export function inspectTailscale(port: number): TailscaleState {
  const envUrl = process.env.PICO_HOST_URL?.trim() || undefined;
  const serveTarget = serveTargetForPort(port);
  const installed = hasTailscale();
  const diagnostics: Diagnostic[] = [];

  if (!installed) {
    diagnostics.push({
      level: "fail",
      code: "missing_tailscale_cli",
      label: "Tailscale CLI",
      detail: "not found",
      fix: "Install Tailscale and sign in on this host.",
    });
    return {
      installed: false,
      running: false,
      serveTarget,
      serveConfigured: Boolean(envUrl),
      serveUrl: envUrl,
      diagnostics,
      ips: [],
    };
  }

  diagnostics.push({ level: "ok", label: "Tailscale CLI", detail: "installed" });

  const status = tailscaleStatus();
  const running = status?.backendState === "Running" && Boolean(status.dnsName);
  if (running) {
    diagnostics.push({
      level: "ok",
      label: "Tailscale node",
      detail: `${status.dnsName}${status.ips.length ? ` (${status.ips.join(", ")})` : ""}`,
    });
  } else {
    diagnostics.push({
      level: "fail",
      code: "tailscale_not_running",
      label: "Tailscale node",
      detail: status?.backendState ? `state=${status.backendState}` : "not signed in or status unavailable",
      fix: "Run `tailscale up` and make sure this machine is in your tailnet.",
    });
  }

  const serveStatus = tailscaleServeStatus();
  const serveConfigured = Boolean(envUrl) || Boolean(serveStatus?.includes(serveTarget));
  const serveUrl = envUrl || (serveConfigured && status?.dnsName ? `https://${status.dnsName}` : undefined);
  diagnostics.push(serveConfigured
    ? { level: "ok", label: "Tailscale Serve", detail: envUrl ? `PICO_HOST_URL=${envUrl}` : serveTarget }
    : {
        level: "warn",
        code: "tailscale_serve_missing",
        label: "Tailscale Serve",
        detail: `no route to ${serveTarget} detected`,
        fix: `pico pair will run: tailscale serve --bg --https=443 ${serveTarget}`,
      });

  return {
    installed: true,
    running,
    backendState: status?.backendState,
    dnsName: status?.dnsName,
    hostName: status?.hostName,
    ips: status?.ips ?? [],
    serveTarget,
    serveStatus,
    serveConfigured,
    serveUrl,
    diagnostics,
  };
}

export function ensureTailscaleServeEffect(
  port: number,
  options: { readonly configure: boolean; readonly inheritStdio?: boolean } = { configure: false },
): Effect.Effect<TailscaleState> {
  return Effect.gen(function* () {
    const initial = inspectTailscale(port);
    if (initial.serveUrl || !initial.installed || !initial.running || !options.configure || process.env.PICO_SKIP_TAILSCALE_SERVE === "1") {
      return initial;
    }

    const serve = yield* runEffect("tailscale", ["serve", "--bg", "--https=443", initial.serveTarget], {
      stdio: options.inheritStdio ? "inherit" : "pipe",
      timeoutMs: 30_000,
    });

    const next = inspectTailscale(port);
    if (serve.status === 0) return next;

    const stderr = runStderr(serve).trim();
    return {
      ...next,
      diagnostics: [
        ...next.diagnostics.filter((diagnostic) => diagnostic.code !== "tailscale_serve_missing"),
        {
          level: "warn",
          code: "tailscale_serve_failed",
          label: "Tailscale Serve",
          detail: stderr || serve.error?.message || "serve command failed",
          fix: `Run after fixing Tailscale: tailscale serve --bg --https=443 ${initial.serveTarget}`,
        },
      ],
    } satisfies TailscaleState;
  });
}

export function ensureTailscaleServe(port: number, options: { readonly configure: boolean; readonly inheritStdio?: boolean } = { configure: false }): Promise<TailscaleState> {
  return Effect.runPromise(ensureTailscaleServeEffect(port, options));
}

function serveTargetForPort(port: number): string {
  return `http://localhost:${port}`;
}
