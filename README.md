# Pico workspace

Pico is an independent, unofficial mobile companion for the Pi coding agent.

## Projects

| Path | Purpose |
| --- | --- |
| [`packages/host/`](./packages/host) | Node/TypeScript Pico host server (`@pico/host`): HTTP/RPC/WebSocket server, sessions, storage, Pi SDK integration. |
| [`packages/cli/`](./packages/cli) | The `pico` host CLI (`pair`, `doctor`, `install`, `status`) plus the host control logic it drives (pairing, service install, diagnostics, local admin client). |
| [`packages/pi-extension/`](./packages/pi-extension) | Pi extension that attaches or hands off a terminal session to Pico with `/pico` or `/rc`. |
| [`pico/`](./pico) | Pico Svelte + Capacitor mobile client. |
| [`packages/protocol/`](./packages/protocol) | Shared Effect Schema definitions and TypeScript types for the RPC/WS protocol. |

## Requirements

- Node.js 26.1+
- pnpm 10.5.2+
- a working `pi` CLI setup in the project you want to use from mobile
- pi provider credentials for live host mode, or `PI_USE_MOCK=1` for mock mode

## Install

```bash
pnpm install
```

This is a pnpm workspace; install from the repository root rather than from each package directory.

## Development

```bash
# Terminal 1: Pico host with mocked pi responses
pnpm dev:host:mock

# Terminal 2: mobile web app
pnpm dev:mobile
```

Then open the Vite URL printed by `pico`.

For live pi instead of mock mode:

```bash
pnpm dev:host
```

## Checks

```bash
pnpm check
```

This typechecks the protocol, host runtime/helper packages, CLI, and builds the mobile app.

## Repository layout

```text
.
├── packages/host/      # Pico host server (@pico/host)
├── packages/cli/       # pico host CLI + host control logic
├── packages/protocol/  # shared protocol schemas/types
├── pico/          # Pico Svelte + Capacitor client
├── package.json         # root workspace scripts
├── pnpm-workspace.yaml  # workspace package list
└── README.md            # this file
```

## Notes

- The original tarballs are import artifacts and are ignored by git.
- Runtime Pico host data (`data/`, SQLite files) is ignored by git.
- Pico is not affiliated with or endorsed by Earendil Inc. or the Pi project.
- The host runtime, CLI, and mobile app all import protocol types from `@pico/protocol`.
- Pico embeds the Pi SDK package for predictable integration, but it uses the current OS user's normal `~/.pi/agent`, git/SSH config, and project directory.

## iPhone native shell

Install dependencies from the workspace root first:

```bash
pnpm install
```

Then create/open the iOS project:

```bash
pnpm --filter pico build
pnpm --filter pico exec cap add ios   # first time only
pnpm --filter pico exec cap sync ios
pnpm --filter pico exec cap open ios
```

## Pico host pairing (experimental)

For a desktop or existing SSH box, the guided setup installs the Pi extension,
starts the user service, configures Tailscale Serve, and prints the phone pairing
link:

```bash
pnpm install
pnpm run setup
```

For a foreground-only development host instead:

```bash
pi --offline --list-models
pnpm run doctor
pnpm pair
```

This uses your normal Pi environment (`$HOME`, `~/.pi/agent`, git/SSH config)
and exposes `127.0.0.1:7777` through `tailscale serve`. Open the printed
`pico://connect?...` link on the phone to save and claim the host.

### Attach an existing terminal Pi session

Pico can also act as a remote-control surface for a Pi session that started in
the terminal. Build and install the workspace extension once:

```bash
pnpm run build:runtime
pnpm run build:extension
pi install ./packages/pi-extension
```

Start the regular system Pi in the same OS account as `pico-host`, then run
`/pico` (or `/rc`). The terminal session appears in Pico and stays synchronized;
run the command again to detach. Choose **move session to background** on the
phone—or run `/pico background`—to finish the active turn, exit terminal Pi,
and continue the same logical session in the background host with full
capabilities. Return an
idle host-owned session safely by ID, ID prefix, or exact title with
`pico resume <session>` (or `pnpm run resume <session>` from this checkout).
The bridge is a local
Unix-domain socket with mode `0600`, not a network listener. See
[`packages/pi-extension/README.md`](./packages/pi-extension/README.md) for the
handoff safety model and socket override.

Useful host commands:

```bash
pnpm run setup        # guided extension + service + Tailscale + pairing setup
pnpm run status       # local admin + Tailscale + Pi compatibility status
pnpm run pair-code    # reprint the current pairing QR/link
pnpm run pair-code -- --rotate # rotate the local pairing token, then print a QR/link
pnpm run serve        # durable foreground host, used by services
pnpm run resume <id>  # safely return a host-owned session to terminal Pi
pnpm run install:host # install a LaunchAgent/systemd --user service
```

## Remote Pico host + iPhone

The intended production shape is:

```text
iPhone app ──Tailscale HTTPS/WSS──> Hetzner VPS: tailscale serve ──localhost──> Pico host (pico-host service) ──> pi agent
```

See [`packages/host/deploy/README.md`](./packages/host/deploy/README.md) for the full server setup. In short: install the prereqs (Node 26.1+, pnpm, Tailscale), place the latest signed release under `/opt/pico-workspace`, and run `pico install --system --create-user --auto-update --tailscale-serve`; authenticate pi either by running `/login` as the `pico-host` server user or by setting API-key env vars in `/etc/pico-host/env`; then enter the `https://…ts.net` host URL in the iPhone app Settings. After that one-time install, shipping a new version is just cutting a `v*` tag — CI builds and signs the release and the box auto-updates itself.
