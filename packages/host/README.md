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

The session list is every session in pi's sessions folder, including ones
started in the terminal, titled as pi's `/resume` shows them (the name, else
the first message). The host indexes the files in SQLite and re-reads only the
ones pi wrote to since the last scan. Renaming sets pi's session name; deleting
deletes pi's file.

pi takes no lock on a session file, so a terminal can carry on a session the
phone has open. The host follows each open session's file as it grows, and
keeps the phone's own place in the tree: it goes on through entries saved
after it, whoever saved them (only pi's own while pi is at work), and pi
reopens there. Messages saved on other branches since the phone last looked
at the tree are counted, and the phone shows the count. pi reads its file
only when it opens it, so before it writes where another pi moved the
phone's line on, the host opens it again there.

The smoke test runs the host over pi-ai's scripted model, in a temporary pi
directory.

## State

| State | Where |
| --- | --- |
| Pi conversation (messages, tool calls) | `~/.pi/agent/sessions/` (pi's own store) |
| Session list: pi's session files indexed (title, cost), plus Pico's archived flag | SQLite at `PICO_HOST_DB` |
| Live fan-out and running sessions | in memory; sessions reopen lazily after a restart |

Phones catch up from pi's own entries, using the last entry id they have.

## Configuration

| Env | Purpose |
| --- | --- |
| `PICO_OWNER` | Tailscale login allowed to use the host. Required unless auth is off. |
| `PICO_HOST_DB` | SQLite path; its directory also holds HTML exports. Required. |
| `PICO_HOST_INSECURE_NO_AUTH` | `=1` disables the identity check. Local dev only. |
