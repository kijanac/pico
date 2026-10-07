# Pico (devbox fork)

Pico is an independent, unofficial phone UI for the [Pi](https://pi.dev) coding agent.
This branch is a personal fork: one host on one dev box, used by one person over
their tailnet. The host serves the web app itself, and the phone opens it as a
home-screen app.

> Pico is not affiliated with or endorsed by Earendil Inc. or the Pi project.

## Layout

| Path | Purpose |
| --- | --- |
| [`packages/host/`](./packages/host) | The host (`@pico/host`): serves the app, RPC and the session WebSocket; runs pi through its SDK. |
| [`packages/protocol/`](./packages/protocol) | Shared Effect Schema definitions for the RPC and WebSocket protocol. |
| [`pico/`](./pico) | The Svelte web app. |
| [`pico.service`](./pico.service) | The systemd user unit that runs the host on the box. |

The host runs pi with the box user's own `~/.pi/agent`: the same logins, settings
and session files as `pi` in a terminal.

## Set up on the box (once)

Requires Node 26 via mise, pnpm, and Tailscale with HTTPS enabled on the tailnet.

```bash
git clone -b devbox https://github.com/kijanac/pico ~/work/pico
cd ~/work/pico && pnpm install && pnpm build
sudo loginctl enable-linger "$USER"          # keep user services running after logout
systemctl --user enable --now ~/work/pico/pico.service
sudo tailscale serve --bg 7777               # https://<box>.<tailnet>.ts.net → the host
```

Then open `https://<box>.<tailnet>.ts.net` in Safari on the phone and use
**Share → Add to Home Screen**.

Only the Tailscale login in `PICO_OWNER` (set in `pico.service`) can use the
host. Edit the unit, then `systemctl --user daemon-reload && systemctl --user restart pico`.

## Update

```bash
cd ~/work/pico && pnpm redeploy   # pull, install, build, restart
```

Logs: `journalctl --user -u pico -f`.

## Develop

```bash
pnpm install
pnpm dev:host        # host on :7777 with your pi, no auth
pnpm dev:web         # Vite on :5173, proxying the host's routes
pnpm check           # typecheck + web build + svelte-check
pnpm test
pnpm smoke:host
```

