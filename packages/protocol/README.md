# @pico/protocol

Shared REST/WebSocket protocol for Pico.

- Runtime schemas are Valibot schemas.
- TypeScript types are derived from those schemas with `v.InferOutput`.
- `packages/host/` uses the schemas at runtime to decode/encode WebSocket events.
- `pi-mobile/` imports the derived types for Pico API and UI state.

When changing the wire protocol, change it here first and run:

```bash
pnpm check
```
