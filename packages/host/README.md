# @pico/host

A Node + Effect Pico host runtime between the [Pico](../pico/) client
and the [Pi](https://pi.dev) coding agent.

## Stack

| Layer          | Pick                              |
| -------------- | --------------------------------- |
| Runtime        | Node 26.1+ (run via `tsx`)        |
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

The Pico host listens on `:7777` (override with `$PORT`).

### Pi modes

| Env                       | Behavior |
| ------------------------- | -------- |
| (none)                    | Live pi via `@earendil-works/pi-coding-agent`. Sessions persisted to `~/.pi/agent/sessions/`. Requires LLM provider credentials configured via `pi auth …` or env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). |
| `PI_USE_MOCK=1`           | Scripted in-process flow. No API keys needed. Same wire shape — useful for client UI work. Blocked under `NODE_ENV=production` unless `PI_ALLOW_UNSAFE_TEST_CLIENT=1` is also set. |
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
| GET    | `/sessions`      | list active host sessions |
| POST   | `/sessions`      | create — body `{ cwd, title }`; runs pi directly in `cwd` |
| GET    | `/sessions/:id`  | metadata |
| WS     | `/ws?session=:id&cursor=:n` | live event stream + send |

## Architecture

```text
HTTP/RPC client ─┐
                 ├──▶ SessionManager ──▶ SessionRuntime
mobile WebSocket ┘          │              ├── durable: embedded Pi SDK
                            │              └── presence: attached terminal Pi
                            └── SQLite event journal + live PubSub
```

`src/session-runtime.ts` is the execution boundary. Both runtime variants
produce the same `SessionEmission` stream and implement the operations they
support. `SessionManager` owns logical sessions, journaling, replay, and mobile
submission deduplication; it branches only on explicit lifecycle semantics
(`durable` or `presence`), never on the transport or UI that created a runtime.
Public capabilities are derived from runtime operations rather than authored as
a second source of truth.

The phone's **move session to background** action and `/pico background` swap a terminal
runtime for a host runtime without changing the logical Pico session ID.
`SessionManager` grants an idle-boundary
generation lease, blocks further operations on that generation, and waits for
the terminal owner PID to exit before committing durable ownership. The
persisted `runtime_session_id` and `runtime_session_file` then bind the logical
session to Pi's original JSONL. Old event pumps cannot emit after the lease, so terminal Pi and the SDK
never write the file concurrently. `pico resume <session-id>` performs the safe
reverse: local admin closes the SDK runtime and removes its durable registration
before ordinary system Pi opens the exact JSONL; a one-time reclaim lease lets
the extension preserve Pico's logical ID when it reconnects.

Foreground `pico serve` and a launchd/systemd-managed host use this same runtime;
the service manager is only a process supervisor, not a separate daemon mode.

Attach protocol 3 reports the terminal Pi version. The host allows transient
remote control across protocol-compatible clients, but grants background only
when terminal Pi is in the embedded SDK's tested minor range and the JSONL
header uses the current session format. `pico doctor` and `pico status` surface
the same compatibility policy.

## Migrations and protocol boundaries

SQLite schema changes run at startup. Runtime lifecycle is persisted internally
so transient presence rows can be removed after a crash without relying on
session ID conventions. Runtime-only fields stay inside host record types;
public protocol responses expose only the mobile contract. Upstream Pi SDK
events are normalized in `src/pi.ts`, while the local extension transport is
normalized in `src/attached-pi-session.ts`.

## Runtime adapters

- `DurableRuntimeFactoryLive` in `src/pi.ts` wraps `createAgentSession()` and
  maps Pi `AgentSessionEvent`s into `SessionEmission`s.
- `DurableRuntimeFactoryMock` provides the scripted development runtime.
- `src/attached-pi-session.ts` adapts a same-user Unix-socket extension peer
  into a transient presence runtime.

`DurableRuntimeFactoryFromEnv` selects the live factory by default or the mock
factory when `PI_USE_MOCK=1`.

## Pico host state vs. pi state

Two layers of persistence:

| State                              | Where                                   | Persists across host restart? |
| ---------------------------------- | --------------------------------------- | ------------------------------- |
| Pi conversation log (messages, tool calls) | `~/.pi/agent/sessions/<id>.jsonl` (pi's own store) | yes |
| Pico host session registry         | SQLite `sessions` table                 | yes |
| Pico host event log (for cursor replay) | SQLite `events` table               | yes |
| Live PubSub fan-out + active runtimes | in-memory                           | durable sessions resume lazily; presence does not |
| Push notification device tokens    | not yet — small JSON file when added    | n/a yet |

Durable session records survive restart and lazily reopen their bound Pi session
file when a client subscribes or sends. The SQLite event journal retains a bounded
replay window; clients behind its prune boundary receive an authoritative
`log_reset`. Presence sessions exist only while their external owner remains
connected and are removed on disconnect or the next host startup.

## Configuration

| Env                | Default            | Purpose |
| ------------------ | ------------------ | --- |
| `PORT`             | 7777               | HTTP/WS listen port |
| `PICO_HOST_DB`        | `data/pico-host.db` | SQLite file path (WAL mode) |
| `PI_USE_MOCK`      | unset              | `=1` to use the scripted mock pi (no API keys). Disabled in production unless explicitly allowed. |
| `PI_ALLOW_UNSAFE_TEST_CLIENT` | unset       | `=1` to intentionally allow the mock test client with `NODE_ENV=production`. |
| `PI_EPHEMERAL`     | unset              | `=1` to use pi's in-memory session manager instead of disk |
