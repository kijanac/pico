# Agent notes

## Workspace

This is a pnpm monorepo with two workspace packages:

- `bridge/` (`pi-bridge`): Node 24+ TypeScript bridge. Main checks: `pnpm --filter pi-bridge typecheck`.
- `pi-mobile/` (`pi-mobile`): Solid + Capacitor client. Main check: `pnpm --filter pi-mobile build`.
- `packages/protocol/` (`@pi-mobile/protocol`): Shared REST/WS Valibot schemas and derived TypeScript types.

Run commands from the repository root.

## Useful commands

```bash
pnpm install
pnpm dev:bridge:mock
pnpm dev:mobile
pnpm check
```

## Important conventions

- Do not commit tarballs; they are import artifacts and ignored by `.gitignore`.
- Do not commit bridge runtime databases or local `.env*` files.
- Keep protocol changes in `packages/protocol/src/index.ts`; bridge and mobile both import `@pi-mobile/protocol`.
- Deployment scripts live in `bridge/deploy/` but deploy from the workspace root because the bridge depends on `packages/protocol`.
