#!/usr/bin/env node
import { setupErrorMessage } from "@pico/host";
import { doctorCommand } from "./commands/doctor.ts";
import { pairCodeCommand, pairCommand } from "./commands/pair.ts";
import { installCommand, logsCommand, parseServiceCliOptions, startCommand, stopCommand, uninstallCommand } from "./commands/service.ts";
import { serveCommand } from "./commands/serve.ts";
import { statusCommand } from "./commands/status.ts";

function usage(): string {
  return `Pico host CLI

Usage:
  pico pair        Run or reuse a Pico host and print a pairing QR/link
  pico pair-code   Print the current pairing QR/link without starting a new host
                   Add --rotate to rotate the token on a running host
  pico serve       Run a durable foreground Pico host (used by services)
  pico doctor      Check local Pico host prerequisites
  pico status      Show local host/Tailscale status
  pico install     Install and start a user service (LaunchAgent/systemd --user)
                 Add --system --user <name> [--create-user] for an advanced Linux system service
  pico start       Start the installed service (add --system for system service)
  pico stop        Stop the installed service (add --system for system service)
  pico logs        Follow installed service logs (add --system for system service)
  pico uninstall   Remove the installed service (add --system for system service)
  pico help        Show this help

Environment:
  PICO_HOST_PORT           Host port, default 7777
  PICO_HOST_BIND           Bind address, default 127.0.0.1
  PICO_HOST_DATA_DIR       Host state directory
  PICO_WORKSPACES_DIR      Directory shown as cwd picker root, default current directory
  PICO_PAIRING_TOKEN       Override generated/stored one-time pairing token
  PICO_HOST_URL            Override printed pairing URL
  PICO_SKIP_TAILSCALE_SERVE=1  Do not run tailscale serve
  PICO_SERVICE_COMMAND     Override service command prefix, e.g. /path/to/pico

Advanced system service:
  pico install --system --user pico-host --create-user
  Installs a root-managed Linux systemd service under the named service account.
  Default install remains a per-user service under the current OS user.
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  switch (command) {
    case "pair":
      await pairCommand();
      return;
    case "pair-code":
      await pairCodeCommand({ rotate: args.includes("--rotate") });
      return;
    case "serve":
      await serveCommand();
      return;
    case "doctor":
      await doctorCommand();
      return;
    case "status": {
      const options = parseServiceCliOptions(rest);
      await statusCommand({ mode: options.mode, systemUser: options.systemUser });
      return;
    }
    case "install":
      installCommand(parseServiceCliOptions(rest));
      return;
    case "uninstall":
      uninstallCommand(parseServiceCliOptions(rest));
      return;
    case "start":
      startCommand(parseServiceCliOptions(rest));
      return;
    case "stop":
      stopCommand(parseServiceCliOptions(rest));
      return;
    case "logs":
      logsCommand(parseServiceCliOptions(rest));
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(usage());
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(usage());
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(setupErrorMessage(error));
  process.exit(1);
});
