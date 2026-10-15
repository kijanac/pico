# F: Pi extension feasibility; G: loading-state audit

Investigated against the installed Pi SDK 1.0.4 and the running Pico app on 2026-10-14. This is planning only, not authorization to build a prototype. The extension design must work with unmodified Pi's supported APIs; a Pi fork or hypothetical upstream additions are outside the requested scope.

## Summary

- **F:** The target is a Pi-native redesign, not running the existing Pico host inside an extension. Pi should own the live agent, session state, resource loading, and persistence; Pico and the TUI should be interfaces to that same runtime. This can remove duplicate ownership and CLI/SDK divergence. Full feature parity needs a precise mapping of public APIs and a few possible Pi-side hooks.
- **G:** Pico already does much of what the article recommends. The best next improvement is to preserve and share data across sheet openings and session switches, not replace activity indicators with skeletons. The tree and directory picker are the clearest targets.

## F — can Pico be a Pi extension?

See [Pi-native Pico: one layer deeper](pi-native-extension-design.md) for the subsequent creation/attachment flows, process-ownership model, public-API capability matrix, and TUI-specific behavior that an extension does not automatically inherit.

### What Pico is today

`packages/host/src/host.ts` runs one HTTP/RPC/WebSocket server. `packages/host/src/runtime.ts` gives its handlers one shared service scope. `packages/host/src/session.ts` manages multiple in-process SDK sessions; it does not launch a separate Pi process per conversation.

The systemd service owns availability. It stays up independently of a terminal, reopens saved sessions on demand, and retains active sessions while they are running or watched. The host also owns provider authentication, filesystem delivery, session indexing, archived flags, and the phone's position in session trees.

The redesign is to stop creating a second SDK runtime when the phone opens a terminal session. Sharing a JSONL file is not sharing a live agent: Pico currently reconstructs another runtime, chooses a phone-specific branch cursor, and separately loads resources and extension UI.

The intended ownership is:

```text
Pi CLI/runtime — sole owner of agent, queue, model, active branch, and session writes
    ├── Pi TUI
    └── Pico extension — web transport and presentation adapter
            └── Pico PWA
```

The network/file transport remains, but the duplicate agent host need not. A small router or supervisor for multiple Pi processes is compatible with this design provided it does not create agents, reconstruct branches, or become a second session authority.

### Public Pi capabilities

The installed extension API can:

- Start an HTTP server using ordinary Node APIs.
- Observe messages, tools, model changes, compaction, settlement, and blocking UI-prompt activity.
- Read the current session's branch, raw entries, tree, name, ID, and file through `ctx.sessionManager`.
- Submit user input with `pi.sendUserMessage()`, including steering/follow-up delivery and explicit template/command expansion.
- Abort, compact, change models/thinking level, rename the session, and enumerate commands through public APIs.

Important boundaries:

- `ExtensionContext.sessionManager` is read-only. It is not an `AgentSession` or a global session registry.
- New-session, fork, tree-navigation, reload, and session-switch operations are on `ExtensionCommandContext`, not the ordinary context provided to lifecycle events. They require a deliberate command integration, not a cast of the event context.
- A context becomes stale after session replacement or reload. A long-lived HTTP callback cannot keep using an old context.
- `ctx.ui.custom()` is a terminal component API, not a mechanism for putting a Svelte web app into Pi.
- `ui_prompt_start/end` tell an observer that Pi is waiting; they do not contain the dialog's options, request identity, or a remote-answer channel. Supporting arbitrary extension dialogs on both phone and terminal requires an explicit UI-routing design.

These are integration boundaries to map, not arguments for retaining the duplicate backend. In particular, `pi.sendUserMessage(..., { expandPromptTemplates: true })` can dispatch a registered extension command. A private control command could therefore receive a fresh command context for session operations. The installed `AgentSession.prompt()` dispatches extension commands before normal prompting or streaming queues. Built-in TUI commands are a different path and should not be assumed to behave identically.

The design must use those existing public paths. Where they do not suffice, identify an extension-only solution or state the feature limitation. Neither hypothetical Pi changes nor a second `AgentSession` hidden inside the extension should be used to claim feasibility.

### Lifecycle experiment

Ran a disposable SDK experiment with an inline extension and temporary session/configuration directories. No prompts were sent; no production sessions or credentials were changed.

| Check | Observed result |
| --- | --- |
| Load the extension factory without binding a session | Factory loaded; zero listening sockets. |
| Start an HTTP listener in `session_start` | HTTP request succeeded and returned the current session ID. |
| Inspect the ordinary event context | Abort, compaction, user-message submission, and command enumeration were available; `newSession` and `switchSession` were not. |
| Replace the active session through `AgentSessionRuntime.newSession()` | `session_shutdown` ran with reason `new`; the old listener closed and the replacement session started a new listener. |
| Start another extension instance on the same fixed port | Pi reported `EADDRINUSE`. |
| Dispose both runtimes | Shutdown handlers closed all listeners. |

This experiment tested listener lifetime only. It does not answer whether the Pi-native redesign simplifies Pico, nor justify preserving today's host. A listener closing on session replacement can be handled by rebinding/reconnecting; a port collision can be avoided with discovery or one transport router. Neither requires duplicate agent ownership.

The existing Pico host already explicitly emits `session_shutdown` before disposing SDK sessions in `packages/host/src/pi.ts`. Plain `AgentSession.dispose()` is not a substitute for that lifecycle notification.

Temporary experiment and output are retained at `/tmp/pico-browser/extension-feasibility.mjs` and `/tmp/pico-browser/extension-feasibility.json`.

### Options

| Shape | Benefit | Cost or changed behavior |
| --- | --- | --- |
| Pure extension: phone companion to one running Pi CLI | Phone and terminal can share the same live agent; uses the CLI's actual extensions and resources. | Availability follows that Pi process. Independent concurrent chats and terminal/phone dialog routing need additional design. Multiple Pi processes need address discovery or a shared coordinator. |
| Move the entire existing host into an extension | One visible parent process; potentially convenient installation. | Most host services remain. Pi exit/reload/session replacement now affect the app. SDK-created sessions must not recursively start the server extension. |
| Keep the host, add a small extension | Can expose `/pico`, publish the current terminal session, or offer a future attachment bridge while retaining always-on availability. | Still has a host process. Attachment must have explicit command ownership; do not resume a second agent on the same file and call it attachment. |
| Keep the SDK host but switch its workers to Pi RPC children | Better process isolation and CLI resource parity. | More processes, not fewer. Requires adapting streaming, UI, control, and shutdown semantics. This is a separate decision from extension packaging. |

Packaging is also separate from process architecture. A Pi package can distribute an extension and prebuilt web assets. Host-supplied Pi packages belong in `peerDependencies`, not bundled copies. Wrapping today's host also retains its Node 26.1+ requirement, whereas Pi itself supports Node 22.19+.

### Revised recommendation — make Pi the backend

The original investigation overemphasized relocating the existing server and protecting its lifetime. The user clarified that the goal is to reconceive Pico around Pi itself. **A thin Pico extension is the architecture to investigate, not an optional bridge bolted onto the current duplicate agent host.**

What should disappear or shrink:

- `openAgentSession()` and the host's independent SDK resource/model initialization: use the real Pi process's existing resources and providers.
- Pico's managed agent map and agent idle-eviction policy: replace with discovery/routing of real Pi runtimes, plus optional process supervision.
- A phone-owned execution branch and file-following reconciliation with another writer: distinguish a UI browsing position from Pi's one canonical active branch.
- Authoritative mirrored status/settings/queue state: read Pi's state and forward its events. Browser caches and wire projections remain, but are disposable views, not independent authorities.
- Duplicated provider-login and extension-UI ownership where existing Pi APIs expose the canonical operation. Where they do not, scope limitations explicitly rather than assume Pi changes.

### Session-list, switching, and creation implications

Pi's exported `SessionManager.listAll()` can supply saved sessions across working directories without constructing another agent. Live sessions additionally need discovery of the Pi processes that own them.

With **one Pi process**, selecting a different conversation for interaction replaces that process's active session. The terminal changes too. The installed runtime aborts the outgoing turn before replacing it: this is not equivalent to Pico's current ability to navigate away while a different conversation keeps running. The UI should distinguish read-only browsing from activation and explicitly confirm an interrupt or wait for completion.

The existing public route is a registered extension control command dispatched through `pi.sendUserMessage(..., { expandPromptTemplates: true })`. Its fresh `ExtensionCommandContext` provides `newSession`, `switchSession`, `fork`, and `navigateTree`, bound in the TUI to Pi's native runtime/UI operations. This route does not require modifying Pi or calling private internals. It needs request correlation and serialization in the extension.

`ctx.newSession()` creates a session in the current runtime's directory. It does not expose a `cwd` option. `ctx.switchSession(path)` can resume an existing session in another directory; Pi rebuilds services from that file's cwd. Arbitrary new-directory creation therefore needs a separate deliberate path. Launching an ordinary Pi process with that working directory is a clean supported option; mutating `process.cwd()` is not a substitute for rebuilding Pi's cwd-bound services.

To **retain concurrent live conversations and the current folder picker**, the extension can discover/launch ordinary Pi processes, each with one active session. Selecting an already-live row attaches to its owner; opening a dormant row resumes it in an available/new Pi process. Creation starts a normal Pi process in the selected directory. This preserves the user-facing session list but adds process-routing/lifetime work, not a second agent implementation.

If terminal access to those same phone-created agents is required, launch interactive Pi processes in persistent PTYs, for example tmux. Attaching to the terminal means attaching to that process. Starting `pi --session <file>` in a second terminal is resumption, not attachment, and recreates the ownership divergence.

No Pi process is needed for every saved row. Read-only history and metadata can stay dormant. Live ownership must be distinguished from persistent session identity, especially when a TUI switches its active session.

What remains legitimately Pico-specific:

- Svelte/mobile rendering, selection, PDF preview, viewport handling, and notifications.
- Authenticated web transport, file delivery, reconnect/snapshot mechanics, and browser command correlation.
- UI preferences and optional archive/index metadata. The current SQLite store already does not store a duplicate transcript; its remaining fields must be classified individually rather than claiming the whole database is an agent backend.

### Integration gaps to resolve

1. **Coherent state and reconnect:** the public extension context exposes saved history and a few live flags, but not a complete reconnect snapshot containing partial messages, running tools, queue contents, and all controls. Extension events cover streaming well; bootstrapping/reloading mid-turn needs a reliable snapshot/event contract.
2. **Commands and acknowledgements:** extension commands provide a plausible lifecycle-control route. Public `pi.sendUserMessage()` returns `void` and reports asynchronous failures through Pi's error channel, so it is not a complete request/acceptance API for the phone. Do not reproduce the whole queue state machine to paper over this.
3. **Multiple renderers:** standard dialogs need a Pi-owned request/response channel that can target the TUI, the phone, or an explicit first-answer policy. Terminal custom components cannot automatically become web components. A mobile extension must not silently replace the TUI's UI context.
4. **Session/process discovery:** one Pi process normally has one active session. Concurrent chats can be separate Pi processes discovered by a router; opening a session already live must attach to its owner, not resume a second writer. Dormant sessions need a deliberate resume/launch path. Always-on availability can come from supervising Pi, not maintaining another agent backend.
5. **Feature mapping:** provider login, persisted settings, queue editing, export, and other current controls need a capability-by-capability comparison against the installed public API. Identify extension-only solutions or unsupported capabilities before asserting complete feature parity.

### Planning decisions before implementation

First decide whether Pico should retain concurrent live chats or accept one shared active-session slot. Decide how terminal and phone session changes interact, how live Pi processes are discovered/kept available, and which current controls can be implemented through supported APIs. Do not build a prototype until those product and ownership decisions are thought through.

If subsequently authorized, a proof would attach a minimal mobile view to a normal Pi TUI process and verify shared identity, branch, input, streaming, steering, abort, and session replacement. It must not instantiate another `AgentSession`, separately load MCP/codemode, or use a shared file as a substitute for shared runtime ownership. Missing public capabilities are constraints on an extension-only design, not permission to modify Pi.

### Pi references reviewed

Read the installed README; extension, SDK, session, session-format, package, TUI, configuration, CLI-integration, RPC, RPC-command, JSON-event, and RPC-extension-UI documentation; the inline-extension/session-runtime examples; and the public extension/session-manager declarations. The installed API and experiment, rather than assumptions about extension tool names, underpin the findings above.

## G — “The perfect app has no loading states”

Source: [Florian Kiem's article](https://floriankiem.com/writing/the-perfect-app-has-no-loading-states).

Its useful principle is: first-use fetching is sometimes unavoidable, but navigation should stay available, revisits should use cached content, and independent work should not form unnecessary waterfalls. It does not justify hiding network failures or showing stale controls as confirmed current state.

### Verification method

Inspected fetching/state ownership across routes and sheets. Also exercised the actual running app in Chromium at a mobile-sized viewport, adding **600 ms of delay to every HTTP RPC request**. This is a controlled delay on loopback, not a measured cellular latency, an iPhone benchmark, or a backend timeout recommendation. WebSocket traffic was not delayed.

The browser visited the session list, opened the Pico conversation, opened/reopened its tree, opened session info, returned to the list, reopened the conversation, and opened providers. It did not send messages, change settings, or initiate authentication.

Evidence is retained at `/tmp/pico-browser/loading-audit.mjs`, `/tmp/pico-browser/loading-audit.json`, and `/tmp/pico-browser/loading-providers.png`.

### What already works

- The session-list route ships in the entry bundle. `App.svelte` warms the other route modules after launch and retains successful imports.
- `RouteShell.svelte` keeps Home navigation usable while route code loads or fails.
- The session list retains non-empty cached rows while refreshing. Returning to it did not show a loading placeholder in the browser test.
- `chat-log.state.svelte.ts` retains three recent conversation logs and reconnects from a bookmark; it does not blank cached history just to reopen a socket.
- Commands, controls, and stats start independently on chat mount. The browser trace showed all three requests starting together, not one waiting for another.
- Session info uses the same stats resource as the chat. Opening it showed cached values immediately, despite issuing a refresh.
- Control patches already display the optimistic value and roll back on failure.
- Highlighting uses plain text first, dynamically loads grammars, warms common languages, and yields between work slices.
- The new file sheet retains recent file content during revalidation. PDF.js is lazy-loaded and renders visible pages rather than waiting for every page.

There is no root-level data-fetch spinner blocking navigation. The remaining spinner placements are primarily operation indicators: tool execution, compaction, retry, branching, tree jumps, provider actions, and pull-to-refresh. Removing those is not the main opportunity.

### Data and ownership inventory

| Surface | Data dependency | Cache/lifetime today | Consequence |
| --- | --- | --- | --- |
| Session list | Stored list, then fresh/indexed list | Shared active/archived arrays | Non-empty revisits are immediate; each refresh still makes two sequential calls. |
| Chat history | Initial/catch-up WebSocket sync | Three recent logs | Good warm-navigation behavior; cold history still waits for sync. |
| Composer commands/model; stats/info | Three independent session RPCs | One owner/value per resource | Same-session cached values can show; switching through another session loses the first session's resource values. Calls are not coalesced. |
| Conversation tree | `sessions.tree` | Local component state | Returning to the menu unmounts it; reopening starts empty and fetches again. |
| Directory picker | `fs.ls` | One listing in the component | No per-path cache; revisits fetch again. Old-directory actions remain available during a different directory's fetch. |
| Providers | `auth.providers` | New state per component instance | Reopening loses metadata and shows loading again. Login/form state has a separate lifetime concern. |
| File sheet | `fs.read`; binary fetch for PDFs | Three recent metadata/text entries | Short back-navigation is immediate; PDF bytes are not persistently cached. |
| Appearance settings | Local theme preferences | Shared local state | No backend data dependency. |

### Prioritized findings

**1. Preserve tree and directory data across revisits.**

The browser test issued `sessions.tree` twice on two successive openings and displayed `loading tree…` both times. Because each request had the simulated delay, even the already-visited tree paid it again.

Move the tree's data into a session-keyed resource. Show the prior tree immediately and revalidate. Invalidate/reconcile from sync, entry, branch, and elsewhere changes—not an arbitrary freshness timer.

Cache directory listings by canonical path. On an uncached path, do not present the previous path's listing as the new path. `CwdPicker.svelte` currently retains the old listing, its row handlers, and its enabled “use this directory” action during the new fetch. A fast tap can therefore act on the old directory. This is a correctness concern as well as a loading-state concern.

**2. Make session resources session-keyed and coalesce concurrent reads.**

`active-session.state.svelte.ts` retains only one `owner/value` for each of commands, controls, and stats. It guards against late responses, but it does not share an in-flight request. The same-session reopen in the browser trace issued commands, controls, and stats again; session info also issued another stats read.

Keep resource values with the same recent-session lifetime as chat logs, and have callers for the same resource/session share one pending read. Background refresh must not erase usable cached data. Newer mutations and invalidations must also beat stale read responses; caching alone is insufficient.

**3. Share provider metadata, not secrets or form drafts.**

`ProviderAuthView.svelte` constructs a new auth state and loads providers on every mount. Move provider names/configuration status into a shared host resource, revalidate on open, and update/invalidate it after successful authentication changes. Do not persist pasted API keys to make the UI feel faster.

**4. Trim the session-list waterfall and distinguish “empty” from “not loaded.”**

The browser trace confirmed the stored-list request followed by the fresh-list request. This is useful for cold startup: old rows arrive before indexing finishes. It is unnecessary as a universal revisit policy once a view already has cached rows.

On cached revisits, refresh the indexed list in the background without first fetching the stored list again. Preserve the cold-start fast path. A cached empty view must remain an empty view while refreshing, rather than becoming a full loading state; current rendering tests only `sessions.length === 0`, despite the state already distinguishing `null` from an empty array.

**5. Prefetch deliberately; do not activate sessions speculatively.**

The app already preloads route code. Extra prefetching should target data likely to be used, with touch-friendly intent such as opening the session menu, not desktop hover alone.

Many host “read” methods currently go through `lookupOrReattach()`. Fetching controls/stats/tree for a cold session can initialize a real SDK session and run extension startup behavior. Do not prefetch every visible session by opening its live controller: that controller changes global active state, and speculative session startup can have side effects.

A future cold-history optimization may need a genuinely read-only snapshot endpoint that reads persisted history/metadata without creating an agent runtime. That is backend work; the first four improvements do not require it.

### Suggested next implementation pass

1. Replace the one-owner session resource wrapper with keyed values and per-key in-flight reads; protect mutations from stale replies.
2. Reuse that resource pattern for the tree. Preserve rows on reopen and revalidate without blanking them.
3. Give the directory picker path-keyed data and disable old-path actions during uncached navigation.
4. Share provider metadata independently from login/form state.
5. Avoid the redundant stored-list fetch on cached revisits; keep cached empty-state rendering honest.

Use the existing Svelte runes architecture. Introducing a new query-library dependency is not necessary for these bounded changes.

Acceptance checks should include repeated sheet openings under delayed RPCs, A → B → A session navigation, cached empty lists, failed refreshes with cached content, stale reads arriving after a control mutation, and directory taps while another path is loading. Real iPhone testing remains necessary for perceived latency and keyboard/viewport behavior.

### Historical documentation caveat

`docs/performance-optimization-opportunities.md` describes older architecture, including an event journal, full-log rendering, and eager route imports. The current code has changed substantially. Do not use that note as proof that those old bottlenecks still exist.
