#!/usr/bin/env node
import { Command, HelpDoc, Options, Span, ValidationError } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { setupErrorMessage } from "@pico/host";
import { doctorCommand } from "./commands/doctor.ts";
import { pairCodeCommand, pairCommand } from "./commands/pair.ts";
import {
  installCommand,
  logsCommand,
  resolveServiceOptions,
  startCommand,
  stopCommand,
  uninstallCommand,
} from "./commands/service.ts";
import { serveCommand } from "./commands/serve.ts";
import { statusCommand } from "./commands/status.ts";

// Shared service flags. --system selects a Linux system service over the default
// per-user service; --user/--create-user apply only when installing one.
const systemMode = Options.boolean("system").pipe(
  Options.withDescription("Target a Linux system service instead of a per-user service"),
);
const systemUser = Options.text("user").pipe(
  Options.withDescription("Service account for --system (default: pico-host)"),
  Options.optional,
);
const createSystemUser = Options.boolean("create-user").pipe(
  Options.withDescription("Create the --system service account if it does not exist"),
);

const pair = Command.make("pair", {}, () => pairCommand).pipe(
  Command.withDescription("Run or reuse a Pico host and print a pairing QR/link"),
);

const pairCode = Command.make(
  "pair-code",
  { rotate: Options.boolean("rotate").pipe(Options.withDescription("Rotate the token on a running host")) },
  ({ rotate }) => pairCodeCommand({ rotate }),
).pipe(Command.withDescription("Print the current pairing QR/link without starting a new host"));

const serve = Command.make("serve", {}, () => serveCommand).pipe(
  Command.withDescription("Run a durable foreground Pico host (used by services)"),
);

const doctor = Command.make("doctor", {}, () => doctorCommand).pipe(
  Command.withDescription("Check local Pico host prerequisites"),
);

const status = Command.make("status", { system: systemMode, user: systemUser }, ({ system, user }) =>
  resolveServiceOptions({ system, user, createUser: false }).pipe(
    Effect.flatMap((options) => statusCommand({ mode: options.mode, systemUser: options.systemUser })),
  ),
).pipe(Command.withDescription("Show local host/Tailscale status"));

const install = Command.make(
  "install",
  { system: systemMode, user: systemUser, createUser: createSystemUser },
  ({ system, user, createUser }) =>
    resolveServiceOptions({ system, user, createUser }).pipe(Effect.flatMap(installCommand)),
).pipe(
  Command.withDescription(
    "Install and start a service (per-user by default; --system installs a root-managed Linux system service)",
  ),
);

const uninstall = Command.make("uninstall", { system: systemMode }, ({ system }) =>
  uninstallCommand({ mode: system ? "system" : "user" }),
).pipe(Command.withDescription("Remove the installed service"));

const start = Command.make("start", { system: systemMode }, ({ system }) =>
  startCommand({ mode: system ? "system" : "user" }),
).pipe(Command.withDescription("Start the installed service"));

const stop = Command.make("stop", { system: systemMode }, ({ system }) =>
  stopCommand({ mode: system ? "system" : "user" }),
).pipe(Command.withDescription("Stop the installed service"));

const logs = Command.make("logs", { system: systemMode }, ({ system }) =>
  logsCommand({ mode: system ? "system" : "user" }),
).pipe(Command.withDescription("Follow installed service logs"));

// Environment variables aren't flags, so document them in the help footer.
const envFooter = HelpDoc.sequence(
  HelpDoc.h1("ENVIRONMENT"),
  HelpDoc.descriptionList([
    [Span.code("PICO_HOST_PORT"), HelpDoc.p("Host port, default 7777")],
    [Span.code("PICO_HOST_BIND"), HelpDoc.p("Bind address, default 127.0.0.1")],
    [Span.code("PICO_HOST_DATA_DIR"), HelpDoc.p("Host state directory")],
    [Span.code("PICO_WORKSPACES_DIR"), HelpDoc.p("Directory shown as cwd picker root, default current directory")],
    [Span.code("PICO_PAIRING_TOKEN"), HelpDoc.p("Override generated/stored one-time pairing token")],
    [Span.code("PICO_HOST_URL"), HelpDoc.p("Override printed pairing URL")],
    [Span.code("PICO_SKIP_TAILSCALE_SERVE"), HelpDoc.p("Set to 1 to skip running tailscale serve")],
    [Span.code("PICO_SERVICE_COMMAND"), HelpDoc.p("Override service command prefix, e.g. /path/to/pico")],
  ]),
);

const pico = Command.make("pico").pipe(
  Command.withDescription("Pico host CLI"),
  Command.withSubcommands([pair, pairCode, serve, doctor, status, install, uninstall, start, stop, logs]),
);

const cli = Command.run(pico, {
  name: "Pico host CLI",
  version: "1.0.1",
  footer: envFooter,
});

const program = cli(process.argv).pipe(
  // @effect/cli prints validation/help errors itself; only friendly-print
  // domain failures (setup/service errors). Always exit non-zero on failure.
  Effect.catchAll((error) =>
    Effect.sync(() => {
      if (!ValidationError.isValidationError(error)) {
        console.error(setupErrorMessage(error));
      }
      process.exitCode = 1;
    }),
  ),
);

NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)));
