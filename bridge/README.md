# pi-bridge

A Node + Effect WebSocket bridge between the [pi-mobile](../pi-mobile/) client
and the [pi.dev](https://pi.dev) coding agent.

## Stack

| Layer          | Pick                              |
| -------------- | --------------------------------- |
| Runtime        | Node 24+ (run via `tsx`)          |
| HTTP           | Hono via `@hono/node-server`      |
| WebSocket      | `ws` package, upgrade routed via Node `server.on('upgrade')` |
| Concurrency    | Effect — Stream / PubSub / Fiber  |
| Validation     | Valibot (shared with mobile)      |
| Persistence    | `node:sqlite` (built-in, RC as of Node 25) |
| pi integration | `@earendil-works/pi-coding-agent` (real) + scripted Mock (dev fallback) |

## Run

```bash
npm install
npm run dev            # tsx watch
# or:
npm start              # one-shot tsx
```

The bridge listens on `:7777` (override with `$PORT`).

### Pi modes

| Env                       | Behavior |
| ------------------------- | -------- |
| (none)                    | Live pi via `@earendil-works/pi-coding-agent`. Sessions persisted to `~/.pi/agent/sessions/`. Requires LLM provider credentials configured via `pi auth …` or env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). |
| `PI_USE_MOCK=1`           | Scripted in-process flow. No API keys needed. Same wire shape — useful for client UI work. |
| `PI_EPHEMERAL=1`          | Live pi but in-memory; sessions vanish on restart. |

### Smoke test

```bash
PI_USE_MOCK=1 npm run dev          # in one terminal
node --experimental-strip-types smoke.ts   # in another
```

## Endpoints

| Method | Path             | |
| ------ | ---------------- | --- |
| GET    | `/healthz`       | liveness |
| GET    | `/sessions`      | list active bridge sessions |
| GET    | `/git/branches?cwd=:path` | list branches for a git repo |
| POST   | `/sessions`      | create — body `{ cwd, title?, branch? }`; git sessions run in a per-session worktree |
| GET    | `/sessions/:id`  | metadata |
| WS     | `/ws?session=:id&cursor=:n` | live event stream + send |

## Architecture

```
HTTP client ─┐
             ├──▶ Hono on @hono/node-server ──┐
mobile WS ──▶ Node http upgrade ──▶ ws ───────┴──▶ SessionManager ──▶ PiClient
                              │                            │
                              └─── one Fiber per conn ◀────┴── PubSub + capped log
                                   • outgoing: Stream<WireEvent> → ws.send
                                   • incoming: Queue<ClientEvent> → mgr.send / interrupt / approve
```

## Wiring real pi

The default is already the real pi. `src/pi.ts` exports two Layers:

- `PiClientLive` — wraps `createAgentSession()`. Pi's `AgentSessionEvent`s
  are mapped into our `PiEmission` shape in `mapEvent()`. The full set of
  event types we handle:
  - `message_update` → `assistant_delta` (when nested type is `text_delta`)
  - `message_end` → `assistant_end`
  - `tool_execution_start` → `tool_call`
  - `tool_execution_end` → `tool_result`
  - `turn_start` / `turn_end` → `status` updates + `cost` when usage is present
- `PiClientMock` — the scripted demo flow, no API needed

The active pick is `PiClientFromEnv` based on `$PI_USE_MOCK`.

### Known gaps in v0 live integration

- **Permission gates skipped.** Pi's permission system is an extension, not
  a core event. Need to register a small extension that bridges pi's
  permission asks to our wire protocol's `permission` event. Until then,
  live pi runs with whatever default policy is configured for the agent.
- **`session.interrupt()` is a no-op.** `AgentSession` doesn't expose a
  public interrupt at the time of writing; we emit a status change but
  pi keeps generating until the turn ends.
- **Tool input/output narrowing uses `@ts-expect-error`.** Pi's tool event
  shapes (`toolCallId`, `input`, `output`, `error`, `isError`) aren't in
  the exported union narrowing — we know them by convention. Tighten when
  pi exports proper discriminators.

## Bridge state vs. pi state

Two layers of persistence:

| State                              | Where                                   | Persists across bridge restart? |
| ---------------------------------- | --------------------------------------- | ------------------------------- |
| Pi conversation log (messages, tool calls) | `~/.pi/agent/sessions/<id>.jsonl` (pi's own store) | yes |
| Bridge session registry            | SQLite `sessions` table                 | yes |
| Bridge event log (for cursor replay) | SQLite `events` table                  | yes |
| Live PubSub fan-out + active fibers | in-memory                              | no (re-attach is a future feature) |
| Push notification device tokens    | not yet — small JSON file when added    | n/a yet |

`GET /sessions` survives restart and lists every session ever created. The
event log is unbounded — clients can `resume` from any cursor and the bridge
will replay from disk. The one thing that does NOT survive restart is the
live attachment to pi: after restart, calling `WS /ws?session=<old-id>`
returns `session_not_found` because there's no `AgentSession` running for
that id in this bridge process. Re-attaching to a dormant session (via pi's
`SessionManager.open()` or `continueRecent()`) is the next obvious feature
and slots into `SessionManager.create()` cleanly.

## Configuration

| Env                | Default            | Purpose |
| ------------------ | ------------------ | --- |
| `PORT`             | 7777               | HTTP/WS listen port |
| `BRIDGE_DB`        | `data/bridge.db`   | SQLite file path (WAL mode) |
| `PI_USE_MOCK`      | unset              | `=1` to use the scripted mock pi (no API keys) |
| `PI_EPHEMERAL`     | unset              | `=1` to use pi's in-memory session manager instead of disk |
