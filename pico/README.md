# Pico web app

The Svelte 5 + Vite + Tailwind app for the [Pi](https://pi.dev) coding agent. The
host serves the production build from `dist/`, and the phone runs it as a
home-screen web app, so the app's own origin is its host.

> Pico is not affiliated with or endorsed by Earendil Inc. or the Pi project.

## Development

From the workspace root:

```bash
pnpm dev:host:mock   # or pnpm dev:host for live pi
pnpm dev:web
```

Vite proxies `/rpc`, `/ws`, `/healthz` and `/sessions` to the host on `:7777`.
