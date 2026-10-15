# Pi-native Pico: one layer deeper

Planning only, using unmodified Pi 1.0.4 and supported extension APIs. No implementation, new runtime experiment, or service change was made for this investigation.

This follows [the initial investigation](extension-feasibility-and-loading-audit.md). The question is whether Pico can become a mobile interface to actual Pi runtimes, not whether the existing SDK host can be relocated into an extension.

## Findings

1. Native session listing, creation in the current directory, resumption, forking, and tree navigation have public integration paths.
2. One Pi process has one active session. Concurrent live chats require multiple native processes, not merely multiple browser routes.
3. An extension can observe and control a live Pi agent, but the extension API is not a complete frontend-neutral replacement for the TUI controller.
4. Important behaviors live in `InteractiveMode`, outside the agent session: built-in command dispatch, input buffering during compaction, editor/queue restoration, and some dialogs/settings.
5. Therefore shared agent ownership is feasible in principle; complete current-Pico feature parity is not established. An extension-only design must explicitly scope unsupported controls or use a native-terminal fallback.

## 1. Separate the identities

A saved **session** has a Pi session ID and, after conversation begins, a JSONL path.

A live **owner** is a particular Pi process. Its active session can change through `/new`, `/resume`, or `/fork`.

A **binding generation** is the current extension instance/context within that process. Session replacement and reload invalidate old contexts even when the operating-system process stays alive.

A browser **view** is what the user is reading. Viewing saved session A need not change a process currently executing session B.

These identities must not be collapsed. In particular:

- Route the PWA by session ID, not PID alone.
- Every control request must identify its expected session and binding. Reject a stale request rather than apply it to the newly active session.
- A terminal session switch changes ownership registration; it does not prove that the outgoing saved session was deleted.
- A connection failure does not prove that the owning Pi process has exited. Do not use it as permission to start a second writer.

The registration map is a disposable view of ownership. It is not a second authority over Pi's active branch, model, or queue.

## 2. Session-list behavior

Pi exports `SessionManager.listAll()` for saved sessions across directories. Reading/listing those files does not require constructing an agent.

The PWA list would combine:

- Saved metadata from Pi's files.
- Live ownership advertised by cooperating Pi processes.
- App-only preferences such as archive flags.

Native Pi does not automatically adopt Pico's archive preference. Nor does the saved-file list prove that a session is currently running.

Suggested distinctions are **live**, **saved/not attached**, and **starting**, rather than synthesizing authoritative idle/running state from file timestamps.

An empty new session is another case: Pi does not create its JSONL file until it contains a user or assistant message. Setup entries and naming alone remain in memory. The list must include a live draft that is not yet in `listAll()`; it must not write a fake conversation just to make the row appear. Whether such drafts survive process exit is a product decision.

### Selecting a row

- **Already live:** attach to that exact owner. No SDK resume, resource reload, or file-following reconstruction.
- **Saved history only:** display it read-only without activating a runtime. Do not start MCP servers merely to view a list or history.
- **Resume:** attach to a known owner, or start/resume a native Pi process after ownership is checked.

Reading and activation can be separate actions, or opening a row can activate it if that is the chosen product behavior. The distinction should exist internally either way.

## 3. One-process design

A normal Pi TUI process runs the Pico extension. Pico's explicit control command uses the current `ExtensionCommandContext`.

### Switching A → B

1. The browser requests activation of B against A's current binding.
2. The extension checks whether replacing A would interrupt work.
3. Apply an explicit wait/stop/cancel policy.
4. Dispatch the extension's control command and call `ctx.switchSession(B.path)`.
5. Pi runs its before-switch hooks, aborts/settles the outgoing operation, replaces the session and cwd-bound services, and rebinds the TUI/extensions.
6. Publish the replacement identity/snapshot from the fresh binding. The phone reconnects if its transport was closed during replacement.

This switches the terminal too. B cannot run concurrently with A in this design. Purely browsing B's saved history need not switch anything.

### Creating a session

`ctx.newSession()` provides a native operation in the current runtime directory. Naming can use its setup callback or `pi.setSessionName()` after replacement through a fresh binding. Forking and tree navigation likewise have public command-context operations.

There is no `cwd` option on `ctx.newSession()`. Existing cross-directory sessions can be resumed; the runtime rebuilds services using the selected file's cwd. Creating a genuinely new conversation in an arbitrary directory needs another path. Launching ordinary Pi there is a clean supported solution, but moves this design into multiple-process orchestration.

Changing `process.cwd()` does not change the already constructed Pi runtime's cwd-bound services. It is not an acceptable shortcut.

## 4. Multiple-native-process design

This preserves Pico's existing ability to move between independent running chats.

```text
PWA
  └── stable authenticated transport/router, supplied by the extension package
        ├── Pi process A + Pico extension + native TUI
        ├── Pi process B + Pico extension + native TUI
        └── saved session files, read without starting an agent
```

The router holds addresses and correlations. It must not instantiate `AgentSession`, reconstruct model context, or choose execution branches independently.

### Create in a chosen directory

1. Validate the folder selection and record a launch request.
2. Launch the normal Pi executable with that cwd, explicit Pico extension loading, and optional native name/session-ID arguments.
3. Use an interactive persistent PTY if later terminal access to the same process matters.
4. Resolve project trust before accepting the worker as ready.
5. The extension advertises the actual session ID, cwd, and current binding.
6. Only then enable agent controls. The draft row may precede the persisted session file.

No Pi source modification or embedded SDK agent is involved. A Pi process is needed for live work, not for every saved row.

### Open B while A runs

Change the browser's attachment, not A's active session. A continues. If B is dormant, use a native process for it rather than replace A.

### Terminal changes a worker's session

If the terminal switches process A to session C, the registry removes A's old session ownership and advertises C. A phone reading the old session may keep that history on screen, but its old composer/control binding must be disabled or rebound through an explicit resume action. It must not accidentally send into C.

If the terminal tries to resume a session already owned by another Pi process, a cooperating extension can use `session_before_switch` to cancel and explain how to attach to the existing terminal. Pi's native TUI is not a remote frontend for another Pi process; a transparent cross-process `/resume` experience cannot be assumed.

### Terminal attachment is not resumption

For a phone-created Pi running in tmux, terminal attachment means attaching to that tmux session. Starting another `pi --session <file>` is a second runtime, not attachment.

Pi instances without the extension do not advertise ownership. A globally installed extension can make normal future instances cooperate, but cannot promise a universal session lock against instances that disable or omit it. Existing instances need to load the extension, for example through a deliberate safe reload. Never silently fall back from failed attachment to creating another writer.

## 5. The stable front door remains a design obligation

Extensions run inside Pi processes. There is no public global Pi daemon/session registry that makes one phone URL automatically cover all processes.

A possible extension-only arrangement is one persistent Pi process hosting the web router, with other Pico-enabled Pi processes connecting to it. It can be an ordinary conversation owner or a dedicated entry process. This remains a proposal, not a finished lifecycle design.

Consequences that must be accepted or resolved:

- Exiting the entry process makes the app unavailable, even if worker agents remain alive.
- Switching/reloading its session invalidates its extension context. The web endpoint needs safe restart/rebinding, not a captured stale `pi` object.
- Always-on availability requires supervising a native Pi entry process. Extension packaging does not eliminate the need for a live server process.
- A native process per live conversation costs more process heaps than today's shared-process SDK host. Resource savings are not established.
- tmux provides a persistent terminal, not by itself independent systemd lifetime. On this box, children inside `pico.service`'s control group die when it restarts. Future worker lifetime must be arranged independently of router restarts.

This is the new complexity purchased in exchange for deleting duplicate agent ownership. Calling it just a thin extension would hide that tradeoff.

## 6. Supported API versus missing frontend operations

| Capability | Installed extension surface | Assessment |
| --- | --- | --- |
| Saved history, active branch, tree, session name | Read-only session manager; exported `SessionManager` for listing | Supported. Read projections remain necessary for the web UI. |
| User input, images, steering/follow-up | `pi.sendUserMessage()` | Supported submission path, but no returned acceptance/error promise on the ordinary extension API. |
| Stream messages/tools | Message/tool lifecycle events | Supported, but a subset of SDK events, not the existing host protocol verbatim. |
| Abort, manual compaction | Context operations | Supported, with different completion/reporting surfaces from direct SDK calls. |
| New/resume/fork/tree/reload | Registered command → fresh command context | Supported. These are real TUI-bound runtime operations. |
| Model/thinking/tools/name | Extension API/context | Supported. Native effects still need projection to the browser. |
| Full queue contents and editing/clearing | Pending-message boolean; no ordinary queue accessor/mutator or `queue_update` extension event | Not available as a drop-in public extension operation. A browser-owned approximation must not be called Pi's queue. |
| Same input behavior as the TUI | Extension input is marked `source: "extension"` | Not identical. Source-sensitive extensions can behave differently. |
| Submit while compacting | TUI buffers in its own compaction queue; agent prompt rejects it | Sharing the agent does not inherit that TUI queue. Scope the behavior explicitly rather than duplicate it unnoticed. |
| Built-in slash commands | Handled by `InteractiveMode`, not extension-command dispatch | `/login`, `/settings`, `!` commands, and other TUI inputs cannot simply be sent through the extension and assumed to execute. |
| Provider authentication | Public `ModelRegistry` is a facade without the live runtime's `login/logout` methods | Not a direct replacement for the current host auth service. Separate public-library workflows or terminal interaction need design. |
| All live settings mutations | Effective settings read; selected explicit setters | General file-backed updates/reload are separate from changing the existing live settings manager. No blanket parity claim. |
| Answer other extensions' dialogs from the phone | `ui_prompt_start/end` expose kind/title, not full request/options/answer channel | No documented generic UI interception/remote-response hook in the extension API. |
| Custom tool/widgets/dialog renderers | Terminal components | Cannot be reused as Svelte components automatically. |
| Project trust | Public `project_trust` decision hook | A personal/explicit extension can deliberately route a trust decision to the phone. Do not silently approve to simplify startup. |

### Why the input distinction matters

The TUI handles its built-in commands, bash mode, compaction buffering, and editor history before calling the agent session's prompt method. Public extension submission calls that prompt method directly with input source `extension`. Some semantics are shared; others belong to the TUI frontend itself.

An extension control command is a valid bridge for lifecycle methods, not proof that every terminal input has a frontend-neutral command equivalent. Control requests should be serialized, correlated, checked against the current binding, and prevented from falling through as LLM prompts.

### Snapshots and event ordering

The extension must retain disposable in-flight display state for browser reconnects. Saved history is canonical in Pi, but it does not include an unfinished assistant stream. Reloading the extension can lose its in-flight cache; report that honestly rather than claim a complete snapshot from unavailable APIs.

`message_end` extension handlers run before final replacement/persistence. Other handlers can transform that message. A web projection must reconcile with saved entries at later turn/settlement boundaries, rather than treat the first observed event as an already committed immutable entry. `agent_settled`, not just `agent_end`, is the final automatic-work boundary.

## 7. Extension-only ways to handle the gaps

There are three distinct approaches. They must not be conflated:

1. **Use documented public hooks:** the default for structured chat/session controls.
2. **Offer a native terminal view/attachment:** a possible fallback for the real TUI's login, settings, queue editing, approvals, and custom components. A browser PTY view would be an additional transport feature to design, not a Pi change. It preserves the actual native UI rather than reimplementing it.
3. **Cooperative integration with particular extensions:** those extensions can publish structured UI through `pi.events` or another deliberate contract. This is not generic support for every existing `ctx.ui` call.

The exposed `ctx.ui` object is mutable in JavaScript, so decorating its methods may be technically possible. The reviewed docs/examples do not establish it as a supported middleware contract. It would rely on shared-object/rebinding behavior and must not be presented as already verified generic dual-UI support. No monkey-patching was implemented or tested here.

Using a separate RPC Pi worker gives richer queue/UI transport, but does not put the native TUI on that same process. Launching a TUI later from its session file would reintroduce the second-owner problem. RPC is not a shortcut to simultaneous native TUI attachment.

## 8. Simplification ledger

| Delete or reduce | Keep | Add or redesign |
| --- | --- | --- |
| Pico's SDK agent creation and CLI resource/bootstrap imitation | Svelte rendering and mobile behavior | Native worker discovery and ownership registration |
| Independent model-runtime initialization for agent workers | Authenticated HTTP/WebSocket/file delivery | Native process launch/supervision and persistent terminal access |
| Separate phone execution cursor and reconciliation against another live writer | Read-only history/tree/tool projections | Session versus process versus binding identity |
| Managed SDK-agent map and agent eviction implementation | Browser caching/reconnect and UI preferences | Public-API control adapter and explicit unsupported-feature policy |
| Authoritative mirrored agent status/settings where Pi exposes them | Optional rebuildable session index/archive metadata | Optional native-terminal fallback |

Do not count all of `packages/host/src/pi.ts` as deletable. Much of it is web projection, coalescing, history paging, and transport correlation, which still has a legitimate role. The durable transcript already lives in Pi's files rather than a second Pico journal.

## 9. Decisions before building

1. Retain concurrent live chats through native processes, or accept one shared active slot?
2. When the terminal changes its session, should the phone follow or retain its current history view?
3. Must every existing extension approval be answerable on the phone? If yes, is a native terminal sheet acceptable for unsupported structured dialogs?
4. Must the queue remain editable in Pico, or can its native UI be the initial control surface?
5. Where does the stable phone endpoint live, and who supervises it and the workers independently?
6. What is the duplicate-owner policy for ordinary terminal startup/resume and Pi instances without Pico?

The strongest currently supportable direction is shared native ownership, structured Pico controls where the public API suffices, and explicitly scoped native-UI fallback where it does not. That solves a real backend divergence without claiming that Pi already exports an entire second-frontend API.

## Source evidence

All Pi paths below are relative to the installed `packages/host/node_modules/@earendil-works/pi-coding-agent/` package.

- `docs/extensions.md`, `docs/sessions.md`, `docs/cli.md`, `docs/cli-integration.md`, `docs/packages.md`, and `docs/security.md`.
- `examples/extensions/project-trust.ts`: supported explicit trust interception.
- `dist/core/extensions/types.d.ts:213–345`: ordinary/command/replacement contexts; `515–530`: project trust; `775–786`: UI-prompt event payload; `1232–1272`: input and selected controls; `1529–1541`: void message submission handlers.
- `dist/core/agent-session-runtime.js:102–172`: outgoing abort and native session/cwd replacement.
- `dist/modes/interactive/interactive-mode.js:1472–1540`: TUI binding of command-context actions; `2580–2705`: native input dispatch; `3883–3955`: TUI-owned compaction queue.
- `dist/core/agent-session.js:648–657`: SDK-only queue event; `720–790`: extension/listener/persistence order; `1513–1557`: command dispatch, compaction rejection, queueing; `1632–1654`: extension-command context; `1844–1871`: input source; `2690–2718`: void submission and error reporting.
- `dist/core/model-registry.d.ts`: extension-visible facade, distinct from `ModelRuntime`.
- `dist/core/session-manager.d.ts:249–257`: deferred persistence of empty sessions; `408–414`: saved-session listing.
- Pico's `packages/host/src/pi.ts`, `session.ts`, `store.ts`, and `mobile-extension-ui-channel.ts`: current ownership versus presentation responsibilities.

These findings are from documentation/type/source inspection. Multi-process routing, remote terminal fallback, duplicate-owner enforcement, and complete feature parity have not been implemented or empirically verified.
