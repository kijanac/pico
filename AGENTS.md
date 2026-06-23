# Agent notes

## Workspace

This is a pnpm monorepo with workspace packages:

- `packages/host/` (`@pico/host`): Node 26.1+ TypeScript Pico host server (HTTP/RPC/WebSocket, sessions, storage, Pi SDK). Main check: `pnpm --filter @pico/host typecheck`.
- `packages/cli/` (`@pico/cli`): The `pico` host CLI plus the host control logic it drives (pairing, service install, diagnostics, local admin client). Main check: `pnpm --filter @pico/cli typecheck`.
- `packages/protocol/` (`@pico/protocol`): Shared RPC/WS Effect Schema definitions and derived TypeScript types.
- `pi-mobile/` (`pico`): Svelte + Capacitor client. Main check: `pnpm --filter pico build`.

Run commands from the repository root.

## Useful commands

```bash
pnpm install
pnpm dev:host:mock
pnpm dev:mobile
pnpm check
```

## Important conventions

- Do not commit tarballs; they are import artifacts and ignored by `.gitignore`.
- Do not commit Pico host runtime databases or local `.env*` files.
- Keep protocol changes in `packages/protocol/src/index.ts`; host and mobile packages import `@pico/protocol`.
- Deployment scripts live in `packages/host/deploy/` but deploy from the workspace root because the Pico host depends on `packages/protocol`.
