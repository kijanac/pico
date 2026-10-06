# Pico Pi extension

This extension lends the Pi session running in your terminal to a co-located
`pico-host`. Pi remains the only owner of the live agent; Pico relays its events
and mobile commands over a same-user Unix-domain socket.

Build the workspace, install the package into Pi, start `pico-host`, then run
`/pico` (or `/rc`) in an interactive Pi session:

```bash
pnpm run build:runtime
pnpm run build:extension
pi install ./packages/pi-extension
pi
```

Run `/pico` again to detach. Choose **move session to background** from the
phone or run `/pico background` (also `/rc background`) to exit terminal Pi and
continue the same session inside `pico-host`. Return an idle host-owned session
by ID, ID prefix, or exact title with `pico resume <session>`; the CLI releases
the SDK writer before opening the
exact JSONL in regular system Pi. Attach
and handoff are intentionally restricted to Pi's interactive TUI; SDK/RPC
sessions cannot attach themselves back into Pico. The default socket is
`~/Library/Application Support/Pico/Host/pi-attach.sock` on macOS and
`${XDG_DATA_HOME:-~/.local/share}/pico/host/pi-attach.sock` elsewhere. Override
it for both processes with `PICO_ATTACH_SOCKET=/absolute/path/pi-attach.sock`.

While attached, the bridge supports a bounded transcript tail, live
transcript/tool streaming, local and mobile prompts, steering/follow-ups,
interrupt, renaming, model selection, thinking level, and session statistics.
Pi remains the sole writer of the terminal transcript.

A plain attachment is terminal-owned presence and disappears when the terminal
disconnects. Background handoff is different: the extension waits for Pi to
settle, obtains a generation lease from the host, and requests graceful process
shutdown. The host does not open the JSONL until the terminal PID has exited;
it then resumes the underlying Pi session behind the same logical Pico session
ID. Protocol 3 also negotiates the terminal and embedded Pi versions and checks
the JSONL session header before granting the lease. Incompatible versions can
still attach for remote control, but cannot background. This prevents terminal
Pi and the SDK from ever writing concurrently.

Remote images, compaction, HTML export, slash-command discovery/execution,
queue management, custom extension UI, and tree navigation are unavailable
only during transient attachment. They become available after a successful
background handoff.
