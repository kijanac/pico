# E — generic background activity and child-agent viewing

Research only. No activity UI, process supervisor, cancellation protocol, or Pi-native runtime redesign is implemented by this investigation.

A separate read-only Pi CLI agent investigated this while J was implemented. Its output is `/tmp/pico-e-investigation.md`; this document is the parent agent's checked synthesis, not an unverified copy of that report.

## Conclusion

Pi exposes sessions and tool executions, not a universal registry of subprocesses or child agents. A truthful running-tools view is possible now. A generic view of background jobs that outlive their launching tool needs cooperating producers to publish an explicit activity contract.

Do not call a running-tools list a sub-agent monitor. In particular, an async launch tool can return successfully while its process continues running. Its `tool_execution_end` is not the background job's completion.

## Verified capabilities

| Capability | Evidence in the installed Pi and current Pico |
| --- | --- |
| Saved conversations | `SessionManager.listAll()` in Pi `dist/core/session-manager.d.ts` lists session files. It cannot discover an in-memory `--no-session` child. |
| Saved lineage | `SessionHeader.parentSession` and `SessionInfo.parentSessionPath` exist in the same declaration. They describe session ancestry/forking, not proof of a currently owned subprocess. |
| Tool execution lifecycle | `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` reach `packages/host/src/pi.ts::makeLive().onEvent`. Current protocol `LiveTool` has id/text/details, but no actual start time or independently persisted background-job status. |
| Nested tool lineage | Pi `dist/core/extensions/types.d.ts` defines `parentToolCallId`; `docs/extensions.md` documents bounded `nestedCalls` metadata. This is in-process `ctx.executeTool`, not a child agent/conversation. Pico currently returns early for nested execution events in `onEvent`. |
| Run completion | `agent_settled` means no further automatic continuation. Neither a message end nor a low-level agent end is that boundary. It also does not prove that an extension-owned detached process exited. |
| Extension cooperation | Pi's public `pi.events` bus has `emit`/`on`; `pi.appendEntry()` persists non-model state. These are building blocks, not an existing standardized activity schema. |
| Cancellation | The owning session can be interrupted. A tool receives an AbortSignal, but the extension decides how that reaches its subprocesses. Pi exposes no universal per-child kill action. |
| Current host's built-ins | `packages/host/src/pi.ts::builtInExtensions` explicitly loads codemode/tool-search/MCP factories. Earlier repository notes about the SDK omitting them describe an older host state, not this one. |

Pi's shipped `examples/extensions/subagent/index.ts` constructs `pi --mode json -p --no-session` around line 300 and launches it with `child_process.spawn` around line 346. It privately parses stdout and reports extension-specific result details. That implementation supplies neither a globally discoverable saved conversation nor a standardized process registration.

The research agent flagged its `tool_result_end` branch as suspicious. The parent review also found that the preceding `message_end` branch records messages of every role, including tool results. The apparently stale extra branch is therefore not evidence that all tool results are missing; it is not a reason to build a parser around that event name.

## Ownership and recovery

Keep these identities separate:

- Saved session id/path and selected branch.
- Live owner and binding generation.
- Tool-call id, including an optional parent tool-call id.
- An explicitly registered background activity id.
- Browser view/read cursor.

The current host's live mirror survives a browser reconnect while the host retains that session. JSONL survives host restart. The mirror does not. Idle eviction only closes sessions with no running/queued work and no viewers; it must not be described as periodically dropping active turns. An unmanaged detached child may nevertheless outlive any owner that failed to register it.

Do not discover activities by opening/resuming every saved session: that initializes runtimes/extensions and can create duplicate live ownership. A cross-session first slice must inspect only already-owned live sessions through a read-only host projection. F still requires actual shared Pi-native ownership, not a second AgentSession reading the same JSONL.

## Minimal useful slices

1. **Running tools:** show actual tool name, origin session, recorded start time, bounded live output and completion for already-owned sessions. Make scope explicit. Whole-session interrupt remains a whole-session action, not a fake per-tool cancel button.
2. **Registered background work:** define a small opt-in schema for any cooperating extension or launcher, not one named sub-agent package. Suggested fields: owner/binding generation, activity id, origin session, kind/label, start time, state, output revision, optional real child-session reference, and explicit supported actions.
3. **Child conversations:** enable navigation only for a supplied, verified saved-session reference or an explicitly exposed read-only live transcript. A `--no-session` child has no history file to guess. Reading it must not create a second writer.

A producer should publish a snapshot when a consumer attaches, then ordered revisions and terminal events. Persist enough metadata to explain past activity, but after owner loss report **unknown / no longer connected**, not completed. Do not infer death from silence or invent polling deadlines.

Cancellation must route to the registered owner with the expected generation. Display **stop requested** until the producer confirms an outcome. An extension that ignores cancellation or detached a child cannot truthfully be presented as stopped. Never accept a client-supplied PID as an authorization capability.

## Limits and privacy

- Distinguish a tail/summary from complete output and label truncation.
- Do not copy arbitrary tool `details`, credentials, environment variables or process command lines into an activity database.
- Keep saved metadata small; fetch longer output on demand through the existing authenticated origin.
- Give output bounds a documented product/resource basis rather than copying arbitrary example constants.
- Keep this a projection over its real owner; transport-neutral records can later come from the planned Pi-native integration.

## Decision still needed

Is the first desired benefit a compact running-tools view, or the longer-lived jobs/child agents themselves? The latter needs a cooperating launcher/extension contract first. No further implementation of E is authorized merely by this investigation.
