# @pico/host

The Node + Effect host between the [Pico](../../pico/) web app and the
[Pi](https://pi.dev) coding agent. It serves the built app, an RPC endpoint and a
session WebSocket, all on one origin behind Tailscale Serve.

## Run

```bash
pnpm dev          # tsx watch src/main.ts
pnpm build        # tsc → dist/; production runs node dist/main.js
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

| Env | Behavior |
| --- | --- |
| (none) | Live pi via `@earendil-works/pi-coding-agent`. |
| `PI_USE_MOCK=1` | Scripted in-process pi; no provider credentials needed. Blocked under `NODE_ENV=production` unless `PI_ALLOW_UNSAFE_TEST_CLIENT=1`. |
| `PI_EPHEMERAL=1` | Live pi with in-memory sessions. |

## State

| State | Where |
| --- | --- |
| Pi conversation (messages, tool calls) | `~/.pi/agent/sessions/` (pi's own store) |
| Pico session registry and event journal | SQLite at `PICO_HOST_DB` |
| Live fan-out and running sessions | in memory; sessions reopen lazily after a restart |

The journal keeps a bounded replay window; a client behind it gets a `log_reset`.

## Configuration

| Env | Purpose |
| --- | --- |
| `PICO_OWNER` | Tailscale login allowed to use the host. Required unless auth is off. |
| `PICO_HOST_DB` | SQLite path; its directory also holds HTML exports. Required. |
| `PICO_WORKSPACES_DIR` | Root the directory picker starts from. Required. |
| `PICO_HOST_INSECURE_NO_AUTH` | `=1` disables the identity check. Local dev only. |
| `PICO_HOST_OTEL` | `=1` prints tracing spans to the console. |
