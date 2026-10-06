# Agent notes

## Workspace

This is a pnpm monorepo. The `devbox` branch is a personal fork: one host serving the web app to one Tailscale user.

- `packages/host/` (`@pico/host`): Node 26.1+ TypeScript host (HTTP/RPC/WebSocket, sessions, storage, Pi SDK, serves `pico/dist`). Main check: `pnpm --filter @pico/host typecheck`.
- `packages/protocol/` (`@pico/protocol`): Shared RPC/WS Effect Schema definitions and derived TypeScript types.
- `pico/` (`pico`): Svelte web app, served by the host and used as a home-screen app. Main check: `pnpm --filter pico build`.

Run commands from the repository root.

## Useful commands

```bash
pnpm install
pnpm dev:host:mock
pnpm dev:web
pnpm check
pnpm test
pnpm smoke:host
```

## Important conventions

- Do not commit Pico host runtime databases or local `.env*` files.
- Keep protocol changes in `packages/protocol/src/index.ts`; host and web packages import `@pico/protocol`.
- The app and host always ship together from one build, so protocol changes need no backward compatibility.
- The box runs `pico.service` (systemd user unit); `pnpm redeploy` updates it.
