# pi mobile workspace

This repository contains the mobile client and local bridge for using the pi coding agent from a phone.

## Projects

| Path | Purpose |
| --- | --- |
| [`bridge/`](./bridge) | Node/TypeScript REST + WebSocket bridge between pi-mobile and the pi coding agent. |
| [`pi-mobile/`](./pi-mobile) | Solid + Capacitor mobile client. |
| [`packages/protocol/`](./packages/protocol) | Shared Valibot schemas and TypeScript types for the REST/WS protocol. |

## Requirements

- Node.js 26.1+
- pnpm 10.5.2+
- pi provider credentials for live bridge mode, or `PI_USE_MOCK=1` for mock mode

## Install

```bash
pnpm install
```

This is a pnpm workspace; install from the repository root rather than from each package directory.

## Development

```bash
# Terminal 1: bridge with mocked pi responses
pnpm dev:bridge:mock

# Terminal 2: mobile web app
pnpm dev:mobile
```

Then open the Vite URL printed by `pi-mobile`.

For live pi instead of mock mode:

```bash
pnpm dev:bridge
```

## Checks

```bash
pnpm check
```

This typechecks the bridge and builds the mobile app.

## Repository layout

```text
.
├── bridge/              # pi bridge service
├── packages/protocol/   # shared protocol schemas/types
├── pi-mobile/           # Solid + Capacitor client
├── package.json         # root workspace scripts
├── pnpm-workspace.yaml  # workspace package list
└── README.md            # this file
```

## Notes

- The original tarballs are import artifacts and are ignored by git.
- Runtime bridge data (`bridge/data/`, SQLite files) is ignored by git.
- The bridge and mobile app both import protocol types from `@pi-mobile/protocol`.

## iPhone native shell

Install dependencies from the workspace root first:

```bash
pnpm install
```

Then create/open the iOS project:

```bash
pnpm --filter pi-mobile build
pnpm --filter pi-mobile exec cap add ios   # first time only
pnpm --filter pi-mobile exec cap sync ios
pnpm --filter pi-mobile exec cap open ios
```

## Remote bridge + iPhone

The intended production shape is:

```text
iPhone app ──Tailscale HTTPS/WSS──> Hetzner VPS: tailscale serve ──localhost──> pi-bridge ──> pi agent
```

See [`bridge/deploy/README.md`](./bridge/deploy/README.md) for the full server setup. In short: run `bridge/deploy/install.sh` on the VPS, deploy with `PI_BRIDGE_HOST=root@YOURBOX ./bridge/deploy/deploy.sh`, authenticate pi either by running `/login` as the `pi-bridge` server user or by setting API-key env vars in `/etc/pi-bridge/env`, expose `localhost:7777` with `tailscale serve`, then enter that `https://…ts.net` URL in the iPhone app Settings.
