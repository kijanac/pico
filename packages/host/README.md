# @pico/host

The Node + Effect host between the [Pico](../../pico/) web app and the
[Pi](https://pi.dev) coding agent. It serves the built app, an RPC endpoint and a
session WebSocket, all on one origin behind Tailscale Serve.

## Run

```bash
pnpm dev:host        # from the repo root: tsx watch with your pi, no auth
pnpm build           # tsc → dist/; production runs node dist/main.js
```

The host binds `127.0.0.1:7777`; Tailscale Serve is its only ingress.

## Endpoints

| Method | Path | |
| --- | --- | --- |
| GET | `/healthz` | liveness (no auth) |
| POST | `/rpc` | Effect RPC (`PicoRpc`) |
| GET | `/ws` | session WebSocket (`PicoSessionRpc`) |
| GET | `/sessions/:id/export.html` | HTML export |
| GET | `/*` | the web app from `pico/dist`, falling back to `index.html` |

Every route except `/healthz` requires the `tailscale-user-login` header that
Tailscale Serve injects to match `PICO_OWNER`.

## Pi integration

`src/pi.ts` wraps the SDK's `createAgentSession()` and maps pi's
`AgentSessionEvent`s onto the wire protocol. It uses pi's default `ModelRuntime`
and `SessionManager`, so the host shares the box user's `~/.pi/agent` (logins,
settings, session files) with terminal pi.

`PI_EPHEMERAL=1` keeps new sessions in memory.

The smoke test runs the host over pi-ai's scripted model, in a temporary pi
directory.

## State

| State | Where |
| --- | --- |
| Pi conversation (messages, tool calls) | `~/.pi/agent/sessions/` (pi's own store) |
| Pico session list (title, cost, archived) | SQLite at `PICO_HOST_DB` |
| Live fan-out and running sessions | in memory; sessions reopen lazily after a restart |

Phones catch up from pi's own entries, using the last entry id they have.

## Configuration

| Env | Purpose |
| --- | --- |
| `PICO_OWNER` | Tailscale login allowed to use the host. Required unless auth is off. |
| `PICO_HOST_DB` | SQLite path; its directory also holds HTML exports. Required. |
| `PICO_WORKSPACES_DIR` | Root the directory picker starts from. Required. |
| `PICO_HOST_INSECURE_NO_AUTH` | `=1` disables the identity check. Local dev only. |
