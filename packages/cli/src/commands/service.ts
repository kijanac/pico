import { resolve } from "node:path";
import { Effect, Option } from "effect";
import {
  defaultServiceCommand,
  installService,
  logsService,
  picoHostPathsFromEnv,
  serviceFilePath,
  startService,
  stopService,
  uninstallService,
  systemPicoHostPathsFromEnv,
  type ServiceMode,
} from "@pico/host";
import { printServiceResults } from "../lib/diagnostics.ts";

export interface ServiceCliOptions {
  readonly mode: ServiceMode;
  readonly systemUser?: string;
  readonly createSystemUser: boolean;
}

// The CLI flags (--system/--user/--create-user) are parsed by @effect/cli; this
// only enforces the cross-flag rule that --user/--create-user imply --system.
export const resolveServiceOptions = (input: {
  readonly system: boolean;
  readonly user: Option.Option<string>;
  readonly createUser: boolean;
}): Effect.Effect<ServiceCliOptions, Error> => {
  const mode: ServiceMode = input.system ? "system" : "user";
  const systemUser = Option.getOrUndefined(input.user);
  if (mode === "user" && (systemUser !== undefined || input.createUser)) {
    return Effect.fail(new Error("--user and --create-user require --system"));
  }
  return Effect.succeed({ mode, systemUser, createSystemUser: input.createUser });
};

function currentServiceCommand() {
  const override = process.env.PICO_SERVICE_COMMAND?.trim();
  if (override) {
    return { executable: "/bin/sh", args: ["-lc", `${override} serve`] };
  }
  return defaultServiceCommand(process.execPath, resolve(process.argv[1] ?? "pico"));
}

export const installCommand = (options: ServiceCliOptions) =>
  Effect.gen(function* () {
    const paths = options.mode === "system" ? systemPicoHostPathsFromEnv(options.systemUser) : picoHostPathsFromEnv();
    const results = yield* installService({
      command: currentServiceCommand(),
      paths,
      mode: options.mode,
      systemUser: options.systemUser,
      createSystemUser: options.createSystemUser,
    });
    yield* Effect.sync(() => {
      if (printServiceResults(results)) return;
      console.log(`\nService file: ${serviceFilePath({ mode: options.mode })}`);
      if (options.mode === "system") {
        console.log("Run `pico status --system` or `pico logs --system` to inspect it.");
        console.log(`Expose it with: sudo tailscale serve --bg --https=443 http://localhost:${paths.port}`);
      } else {
        console.log("Run `pico status` or `pico logs` to inspect it.");
      }
    });
  });

export const uninstallCommand = (options: { readonly mode: ServiceMode }) =>
  uninstallService({ mode: options.mode }).pipe(
    Effect.flatMap((results) => Effect.sync(() => void printServiceResults(results))),
  );

export const startCommand = (options: { readonly mode: ServiceMode }) =>
  startService({ mode: options.mode }).pipe(
    Effect.flatMap((results) => Effect.sync(() => void printServiceResults(results))),
  );

export const stopCommand = (options: { readonly mode: ServiceMode }) =>
  stopService({ mode: options.mode }).pipe(
    Effect.flatMap((results) => Effect.sync(() => void printServiceResults(results))),
  );

export const logsCommand = (options: { readonly mode: ServiceMode }) => logsService({ mode: options.mode });
