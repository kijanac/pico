import { Effect } from "effect";
import { commandExists, run, runInherit, runOutput } from "./exec.ts";
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

const serveTargetForPort = (port: number): string => `http://localhost:${port}`;

export const hasTailscale = () => commandExists("tailscale", ["version"]);

export const tailscaleStatus = () =>
  run("tailscale", ["status", "--json"], { timeoutMs: 8_000 }).pipe(
    Effect.map((result): TailscaleStatus | undefined => {
      if (result.exitCode !== 0) return undefined;
      try {
        const status = JSON.parse(result.stdout) as {
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
    }),
  );

export const tailscaleServeStatus = () =>
  run("tailscale", ["serve", "status"], { timeoutMs: 8_000 }).pipe(
    Effect.map((result) => (result.exitCode !== 0 ? undefined : runOutput(result) || undefined)),
  );

export const inspectTailscale = (port: number) =>
  Effect.gen(function* () {
    const envUrl = process.env.PICO_HOST_URL?.trim() || undefined;
    const serveTarget = serveTargetForPort(port);
    const installed = yield* hasTailscale();
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
      } satisfies TailscaleState;
    }

    diagnostics.push({ level: "ok", label: "Tailscale CLI", detail: "installed" });

    const status = yield* tailscaleStatus();
    const running = status?.backendState === "Running" && Boolean(status.dnsName);
    diagnostics.push(running
      ? {
          level: "ok",
          label: "Tailscale node",
          detail: `${status?.dnsName}${status?.ips.length ? ` (${status.ips.join(", ")})` : ""}`,
        }
      : {
          level: "fail",
          code: "tailscale_not_running",
          label: "Tailscale node",
          detail: status?.backendState ? `state=${status.backendState}` : "not signed in or status unavailable",
          fix: "Run `tailscale up` and make sure this machine is in your tailnet.",
        });

    const serveStatus = yield* tailscaleServeStatus();
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
    } satisfies TailscaleState;
  });

export const ensureTailscaleServe = (
  port: number,
  options: { readonly configure: boolean; readonly inheritStdio?: boolean } = { configure: false },
) =>
  Effect.gen(function* () {
    const initial = yield* inspectTailscale(port);
    if (initial.serveUrl || !initial.installed || !initial.running || !options.configure) {
      return initial;
    }

    const serveArgs = ["serve", "--bg", "--https=443", initial.serveTarget];
    const serve = options.inheritStdio
      ? yield* runInherit("tailscale", serveArgs, { timeoutMs: 30_000 }).pipe(
          Effect.map((exitCode) => ({ exitCode, stderr: "" })),
        )
      : yield* run("tailscale", serveArgs, { timeoutMs: 30_000 }).pipe(
          Effect.map((result) => ({ exitCode: result.exitCode, stderr: result.stderr.trim() })),
        );

    const next = yield* inspectTailscale(port);
    if (serve.exitCode === 0) return next;

    return {
      ...next,
      diagnostics: [
        ...next.diagnostics.filter((diagnostic) => diagnostic.code !== "tailscale_serve_missing"),
        {
          level: "warn",
          code: "tailscale_serve_failed",
          label: "Tailscale Serve",
          detail: serve.stderr || "serve command failed",
          fix: `Run after fixing Tailscale: tailscale serve --bg --https=443 ${initial.serveTarget}`,
        },
      ],
    } satisfies TailscaleState;
  });
