# Multi-host mobile architecture

## Goal

Support multiple Pico hosts without requiring the user to switch host views before opening an existing session.

The invariant is that every session reference is host-qualified: `hostId` travels with `sessionId` through routes, state, RPC calls, drafts, queues, and local echoes. The UI may present one merged session list, but the app never treats a bare `sessionId` as globally meaningful.

## Routes

```text
/                         merged sessions
/h/:hostId/s/:sessionId   exact chat route
/settings                 settings + host management
/connect                  add or update host
/welcome                  onboarding
```

Bare `/s/:sessionId` routes are not part of the multi-host app. Existing session links must be host-qualified so there is no resolver, query-all-hosts fallback, or global host switch required to open a session.

## Persisted host registry

```ts
type HostProfile = {
  id: string;
  name: string;
  url: string;
  addedAt: number;
  lastSeenAt?: number;
  systemInfo?: SystemInfo;
};
```

Preferences:

```text
pico_hosts_v1         HostProfile[]
pico_default_host_id  string
welcome_skipped       existing
```

Migration:

1. Read existing `host_url`.
2. Create the first host profile.
3. Store `pico_hosts_v1` and `pico_default_host_id`.
4. From then on, code uses host profiles only.

## Session list UX

The sessions screen displays a merged, sorted list:

```text
┌────────────────────────────┐
│ sessions              ⚙︎    │
├────────────────────────────┤
│ quantum-rs                  │
│ ~/workspaces/quantum-rs     │
│ pi-coding-agent        ●    │
├────────────────────────────┤
│ pico                        │
│ ~/workspaces/pico           │
│ desk-host              ●    │
└────────────────────────────┘
                         ＋
```

Each row carries `{ hostId, session }` and links directly to `/h/:hostId/s/:sessionId`.

For the first implementation, unreachable hosts show a compact host-level error/retry row. We do not show cached session rows while offline.

## New session UX

New sessions need a target host:

```text
┌────────────────────────────┐
│ new session                 │
├────────────────────────────┤
│ host                        │
│ [ pi-coding-agent      ▾ ]  │
│                             │
│ directory                   │
│ [ ~/workspaces/pico    ▾ ]  │
│                             │
│ title                       │
│ [ pico                 ]    │
│                             │
│ create                      │
└────────────────────────────┘
```

The default host is preselected. CWD browsing and creation run against the selected host.

## Chat UX

The chat route is host-qualified:

```text
/h/pi-main/s/019f...
```

```text
┌────────────────────────────┐
│ ‹  quantum-rs         ●     │
│    pi-coding-agent          │
├────────────────────────────┤
│ messages...                 │
├────────────────────────────┤
│ model · context · queue     │
│ [ ask...              ↑ ]   │
└────────────────────────────┘
```

All chat code receives `hostId` with `sessionId` and all RPC calls use `runOnHost(hostId, ...)`.

## Settings / connect UX

Settings includes host management:

```text
┌────────────────────────────┐
│ settings                    │
├────────────────────────────┤
│ hosts                       │
│                             │
│ pi-coding-agent        ●    │
│ https://...ts.net           │
│ default                     │
│                             │
│ desk-host              ●    │
│ https://...ts.net           │
│                             │
│ + add host                  │
├────────────────────────────┤
│ appearance                  │
└────────────────────────────┘
```

Connect adds or updates a host profile instead of replacing a single global URL. Provider auth and host update/status remain host-scoped.

## State namespaces

```text
RPC runtime       by host.url
sessions         sessionsByHost[hostId]
chat log         logs[hostId:sessionId]
queue            queues[hostId:sessionId]
draft            chat_draft:${hostId}:${sessionId}
local echoes      keyed by hostId:sessionId
active session    { hostId, sessionId }
```

## Implementation order

1. Add host registry state and migrate `host_url`.
2. Add host-aware RPC helpers.
3. Change routes to `/h/:hostId/s/:sessionId`.
4. Thread `hostId` alongside `sessionId` through chat state and stream controller.
5. Namespace chat log, queue, drafts, queued-message actions, retry/active state.
6. Convert session list state and UI to merged host/session rows.
7. Add host selection to new-session and cwd picker calls.
8. Update settings/connect/onboarding to manage host profiles.
9. Run checks/builds and test a real host open.
