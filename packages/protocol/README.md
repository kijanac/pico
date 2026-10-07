# @pico/protocol

The wire protocol between the Pico host and web app: Effect Schema definitions
and the TypeScript types derived from them.

- `src/index.ts`: wire messages, session metadata and the event log entries.
- `src/rpc.ts`: the `PicoRpc` (HTTP) and `PicoSessionRpc` (WebSocket) groups.
- `src/log.ts`: the reducer both sides use to fold events into a session log.

The host and app always ship from one build, so changes need no backward
compatibility. Change the schema here, then run `pnpm check` from the root.
