import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { FetchHttpClient, FileSystem } from "@effect/platform";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { Duration, Effect, Layer } from "effect";
import { PicoRpc } from "@pico/protocol/rpc";
import { getBundledPiSdkVersion } from "@pico/host-runtime/host";
import { commandExists, run, runOutput } from "./exec.ts";
import type { Diagnostic } from "./errors.ts";
import { healthcheck, portIsOpen } from "./network.ts";
import { picoHostPathsFromEnv } from "./paths.ts";
import { inspectTailscale } from "./tailscale.ts";

const MIN_NODE_MAJOR = 26;
const MIN_NODE_MINOR = 1;
const PI_MODEL_LIST_TIMEOUT_MS = 15_000;

function nodeVersionOk(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
}

const pathCheck = (label: string, path: string, opts?: { createHint?: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!exists) {
      return {
        level: opts?.createHint ? "warn" : "fail",
        code: "path_missing",
        label,
        detail: path,
        fix: opts?.createHint ? "pico pair will create this directory." : "Create this directory or choose a different path.",
      } satisfies Diagnostic;
    }
    const writable = yield* fs
      .access(path, { readable: true, writable: true })
      .pipe(Effect.as(true), Effect.catchAll(() => Effect.succeed(false)));
    if (!writable) {
      return { level: "fail", code: "path_not_writable", label, detail: path, fix: "Grant read/write access or choose a different path." } satisfies Diagnostic;
    }
    return { level: "ok", label, detail: path } satisfies Diagnostic;
  });

const providerAuthSummary = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const authFile = join(homedir(), ".pi/agent/auth.json");
    const envKeys = [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_OAUTH_TOKEN",
      "OPENAI_API_KEY",
      "AZURE_OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "OPENROUTER_API_KEY",
      "AI_GATEWAY_API_KEY",
      "DEEPSEEK_API_KEY",
      "GROQ_API_KEY",
      "CEREBRAS_API_KEY",
      "XAI_API_KEY",
      "FIREWORKS_API_KEY",
      "TOGETHER_AI_API_KEY",
      "ZAI_API_KEY",
      "MISTRAL_API_KEY",
      "AWS_PROFILE",
    ].filter((key) => Boolean(process.env[key]?.trim()));

    const hasAuthFile = yield* fs.exists(authFile).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (hasAuthFile) return { level: "ok", label: "Pi auth", detail: authFile } satisfies Diagnostic;
    if (envKeys.length > 0) return { level: "ok", label: "Pi auth", detail: `provider env set: ${envKeys.join(", ")}` } satisfies Diagnostic;
    return {
      level: "warn",
      code: "provider_auth_missing",
      label: "Pi auth",
      detail: "no ~/.pi/agent/auth.json or common provider API key env found",
      fix: "Run `pi /login`, export a provider API key, or sign in through Pico provider auth after pairing.",
    } satisfies Diagnostic;
  });

const piCliVersionCheck = () =>
  run("pi", ["--version"], { timeoutMs: 5_000 }).pipe(
    Effect.map((result): Diagnostic =>
      result.exitCode === 0
        ? { level: "ok", label: "Installed pi CLI", detail: runOutput(result) || "available" }
        : {
            level: "warn",
            code: "missing_pi_cli",
            label: "Installed pi CLI",
            detail: result.stderr.trim() || "not found",
            fix: "Optional for Pico itself: install Pi only if this OS user needs the standalone `pi` CLI or extensions that shell out to it.",
          },
    ),
  );

const sdkVersionChecks = () =>
  Effect.gen(function* () {
    const bundledVersion = yield* getBundledPiSdkVersion;
    const cliVersion = runOutput(yield* run("pi", ["--version"], { timeoutMs: 5_000 }));
    const checks: Diagnostic[] = [
      bundledVersion
        ? { level: "ok", label: "Embedded Pi SDK", detail: bundledVersion }
        : { level: "warn", label: "Embedded Pi SDK", detail: "version unavailable" },
    ];

    if (bundledVersion && cliVersion && bundledVersion !== cliVersion) {
      checks.push({
        level: "warn",
        label: "Pi version skew",
        detail: `embedded SDK ${bundledVersion} != installed CLI ${cliVersion}`,
        fix: "Pico uses its embedded SDK but reads the same ~/.pi/agent state. Upgrade Pico if CLI behavior differs.",
      });
    }

    return checks;
  });

const projectContextCheck = (workspacesDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const candidates = [
      "AGENTS.md",
      "CLAUDE.md",
      ".pi/settings.json",
      ".pi/SYSTEM.md",
      ".pi/APPEND_SYSTEM.md",
      ".pi/extensions",
      ".pi/skills",
      ".pi/prompt-templates",
    ];
    const interesting: string[] = [];
    for (const rel of candidates) {
      const exists = yield* fs.exists(join(workspacesDir, rel)).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (exists) interesting.push(rel);
    }

    if (interesting.length > 0) {
      return { level: "ok", label: "Pi project context", detail: interesting.join(", ") } satisfies Diagnostic;
    }
    return {
      level: "warn",
      label: "Pi project context",
      detail: "no AGENTS.md, CLAUDE.md, or .pi/ config found at the workspace root",
      fix: "This is fine for a blank project. Add AGENTS.md or .pi/settings.json if Pi needs project-specific instructions/settings.",
    } satisfies Diagnostic;
  });

const piModelRegistryCheck = (workspacesDir: string) =>
  Effect.gen(function* () {
    if (!(yield* commandExists("pi", ["--version"]))) {
      return {
        level: "warn",
        code: "missing_pi_cli",
        label: "Pi model registry",
        detail: "skipped because `pi` is not available",
        fix: "This is OK for bundled Pico runtime. Install Pi if you want to debug the standalone CLI/model registry.",
      } satisfies Diagnostic;
    }

    const result = yield* run("pi", ["--offline", "--list-models"], { cwd: workspacesDir, timeoutMs: PI_MODEL_LIST_TIMEOUT_MS });
    if (result.exitCode === 0) {
      const lines = runOutput(result).split(/\r?\n/).filter((line) => line.trim());
      const modelCount = Math.max(0, lines.length - 1);
      return {
        level: "ok",
        label: "Pi model registry",
        detail: `${modelCount} model${modelCount === 1 ? "" : "s"} visible from ${workspacesDir}`,
      } satisfies Diagnostic;
    }

    return {
      level: "warn",
      code: "pi_model_registry_failed",
      label: "Pi model registry",
      detail: result.timedOut
        ? `timed out after ${PI_MODEL_LIST_TIMEOUT_MS / 1000}s`
        : result.stderr.trim() || "pi --offline --list-models failed",
      fix: "Pico uses its embedded Pi SDK, but this can still indicate broken Pi settings/extensions for this workspace.",
    } satisfies Diagnostic;
  });

const makeRpcClient = RpcClient.make(PicoRpc);
type RpcClientService = Effect.Effect.Success<typeof makeRpcClient>;

const rpcClientLayer = (hostUrl: string) =>
  RpcClient.layerProtocolHttp({ url: `${hostUrl.replace(/\/+$/, "")}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );

// Probe one rpc method on a host (8s timeout), returning an Either so the caller
// can render a diagnostic from either the value or the typed failure.
const probeHost = <A, E>(hostUrl: string, call: (client: RpcClientService) => Effect.Effect<A, E>) =>
  makeRpcClient.pipe(
    Effect.flatMap(call),
    Effect.scoped,
    Effect.provide(rpcClientLayer(hostUrl)),
    Effect.timeout(Duration.seconds(8)),
    Effect.either,
  );

const tailscaleIdentityCheck = (options: { readonly portOpen: boolean; readonly port: number; readonly hostUrl?: string }) =>
  Effect.gen(function* () {
    const serveTarget = `http://localhost:${options.port}`;

    if (!options.hostUrl) {
      return {
        level: "warn",
        code: "tailscale_serve_missing",
        label: "Tailscale identity",
        detail: "not checked; no Tailscale Serve URL detected",
        fix: `Start a host with \`pico pair\` or run: tailscale serve --bg --https=443 ${serveTarget}`,
      } satisfies Diagnostic;
    }

    if (!options.portOpen) {
      return {
        level: "warn",
        code: "host_health_timeout",
        label: "Tailscale identity",
        detail: `${options.hostUrl} detected, but local host port is not listening`,
        fix: "Start the Pico host, then rerun `pico doctor`.",
      } satisfies Diagnostic;
    }

    const hostUrl = options.hostUrl;
    const healthy = yield* healthcheck(hostUrl).pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!healthy) {
      return {
        level: "fail",
        code: "tailscale_identity_unavailable",
        label: "Tailscale identity",
        detail: `${hostUrl}/healthz is not reachable`,
        fix: "Check Tailscale, Serve, and that your phone/host are in the same tailnet.",
      } satisfies Diagnostic;
    }

    const identityResult = yield* probeHost(hostUrl, (client) => client.system.identity());

    if (identityResult._tag === "Left") {
      const error = identityResult.left;
      return {
        level: "fail",
        code: "tailscale_identity_unavailable",
        label: "Tailscale identity",
        detail: error instanceof Error ? error.message : String(error),
        fix: "Call the host through the https://*.ts.net Serve URL so Tailscale can inject identity headers.",
      } satisfies Diagnostic;
    }

    const identity = identityResult.right;
    if (!identity.user) {
      return {
        level: "warn",
        code: "tailscale_identity_unavailable",
        label: "Tailscale identity",
        detail: "system.identity succeeded without a Tailscale user (auth may be disabled)",
      } satisfies Diagnostic;
    }
    return {
      level: "ok",
      label: "Tailscale identity",
      detail: `${identity.user} (${identity.claimed ? "claimed" : "unclaimed"})`,
    } satisfies Diagnostic;
  });

const hostProviderAuthCheck = (options: { readonly portOpen: boolean; readonly hostUrl?: string }) =>
  Effect.gen(function* () {
    if (!options.portOpen || !options.hostUrl) return undefined;

    const hostUrl = options.hostUrl;
    const authResult = yield* probeHost(hostUrl, (client) => client.auth.providers());

    if (authResult._tag === "Left") {
      const error = authResult.left;
      return {
        level: "warn",
        code: "provider_auth_missing",
        label: "Host provider auth",
        detail: error instanceof Error ? error.message : String(error),
        fix: "This check requires a running, claimed host reachable through Tailscale Serve.",
      } satisfies Diagnostic;
    }

    const auth = authResult.right;
    const configured = auth.providers.filter((provider) => provider.configured).length;
    const total = auth.providers.length;
    return configured > 0
      ? ({ level: "ok", label: "Host provider auth", detail: `${configured}/${total} provider${total === 1 ? "" : "s"} configured` } satisfies Diagnostic)
      : ({
          level: "warn",
          code: "provider_auth_missing",
          label: "Host provider auth",
          detail: `${total} provider${total === 1 ? "" : "s"} listed, none configured`,
          fix: "Run `pi /login`, export an API key, or use Pico provider auth after pairing.",
        } satisfies Diagnostic);
  });

export const collectDoctorChecks = () =>
  Effect.gen(function* () {
    const paths = picoHostPathsFromEnv();
    const tailscale = yield* inspectTailscale(paths.port);
    const portOpen = yield* portIsOpen(paths.host, paths.port).pipe(Effect.catchAll(() => Effect.succeed(false)));

    const [sdkChecks, piCli, workspacePath, dataPath, projectContext, modelRegistry] = yield* Effect.all([
      sdkVersionChecks(),
      piCliVersionCheck(),
      pathCheck("Workspace root", paths.workspacesDir, { createHint: true }),
      pathCheck("Host data dir", paths.dataDir, { createHint: true }),
      projectContextCheck(paths.workspacesDir),
      piModelRegistryCheck(paths.workspacesDir),
    ]);

    const checks: Diagnostic[] = [
      nodeVersionOk()
        ? { level: "ok", label: "Node", detail: process.version }
        : { level: "fail", code: "node_version_too_old", label: "Node", detail: process.version, fix: "Install Node.js 26.1 or newer." },
      { level: "ok", label: "User", detail: `${userInfo().username} (${homedir()})` },
      ...sdkChecks,
      piCli,
      workspacePath,
      dataPath,
      projectContext,
      modelRegistry,
      portOpen
        ? {
            level: "warn",
            code: "host_port_in_use",
            label: "Host port",
            detail: `${paths.host}:${paths.port} is already listening`,
            fix: "This is OK if it is your Pico host. Stop it before running a new foreground `pico pair`, or set PICO_HOST_PORT.",
          }
        : { level: "ok", label: "Host port", detail: `${paths.host}:${paths.port} is free` },
      ...tailscale.diagnostics,
    ];

    const [identityCheck, hostProviderAuth] = yield* Effect.all(
      [
        tailscaleIdentityCheck({ portOpen, port: paths.port, hostUrl: tailscale.serveUrl }),
        hostProviderAuthCheck({ portOpen, hostUrl: tailscale.serveUrl }),
      ],
      { concurrency: "unbounded" },
    );
    checks.push(identityCheck);
    if (hostProviderAuth) checks.push(hostProviderAuth);
    checks.push(yield* providerAuthSummary());
    return checks;
  });
