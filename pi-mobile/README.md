# Pico

Pico is an independent, unofficial mobile companion for the [Pi](https://pi.dev) coding agent.

> Pico is not affiliated with or endorsed by Earendil Inc. or the Pi project.

## Stack

- Svelte 5
- TypeScript
- Vite
- Tailwind CSS
- Capacitor

## Development

Run from the workspace root:

```bash
pnpm install
pnpm dev:mobile
```

For a native iOS shell:

```bash
pnpm --filter pico build
pnpm --filter pico exec cap sync ios
pnpm --filter pico exec cap open ios
```
