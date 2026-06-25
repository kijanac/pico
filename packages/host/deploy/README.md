# pico-host deployment

Target shape: a single Hetzner (or any Linux) VPS reachable only over
Tailscale, running pico-host under systemd, with `tailscale serve`
providing the HTTPS endpoint the mobile app talks to.

## Why this shape

- **No public exposure.** The Pico host sits behind `tailscale serve`, not
  on the open internet. Binding to `127.0.0.1` keeps Tailscale Serve as the
  only ingress, and production requests require Tailscale identity headers
  from Serve.
- **HTTPS is solved.** iOS App Transport Security blocks plain HTTP, and the
  Capacitor WebView is no different. `tailscale serve` mints Let's Encrypt
  certs for `*.<your-tailnet>.ts.net` for free, so the mobile gets a proper
  `https://` URL with zero cert maintenance.
- **One box, one process.** A single-user Pico host doesn't need Docker, k8s,
  or load balancing. systemd + restart-on-failure is enough and stays
  diagnosable through `journalctl`.

## How shipping works

There is exactly **one** deploy path: cut a `v*` tag → CI builds and signs a
release → the box auto-updates itself from `releases/latest`. The box only ever
runs released, signed, versioned code; there is no "push from my laptop" path.
Local iteration happens on your laptop (`pnpm dev`), never against the box.

```text
/opt/pico-workspace/
  releases/<version>/        # one prebuilt, prod-installed release tree per version
  current -> releases/<version>
  host-update.mjs            # the updater, OUTSIDE current so it survives the swap
/etc/pico-host/
  env                        # provider keys / flags (chmod 640, never clobbered)
  update-public-key.pem      # verifies release signatures
/var/lib/pico-host/          # service HOME + data dir
  pico-host.db               # SQLite
  workspaces/                # git repos the agent works in
  .pi/agent/auth.json        # pi provider credentials
```

## Prereqs (install these yourself)

These are documented prerequisites, not something a bootstrap script installs.
On the box, as root:

- **Node 26.1+** (the host uses `node:sqlite`, stable on 26).
- **pnpm 10.5.2** (`npm i -g pnpm@10.5.2`) — the box runs `pnpm install --prod`
  against the release lockfile to resolve arch-correct native deps.
- **git** and **Tailscale**, with the box joined to your tailnet (`tailscale up`).
- A pi-supported subscription login (Claude Pro/Max, ChatGPT Plus/Pro/Codex,
  GitHub Copilot) **or** a provider API key.

The mobile/phone side just needs the Tailscale app signed into the same tailnet.

## First-time install (one time per box)

The box runs the **bundled CLI from a placed release** — `pico install` copies the
systemd units, the updater, and the signing key out of the release tree, so it
must run from a release, not a bare `npm i -g @pico/cli` (which doesn't ship the
unit templates). Place the latest release, then install:

```sh
# on the box, as root, with the prereqs above installed
REPO=kijanac/pico
VER=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -m1 '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')

curl -fsSL -o /tmp/pico-host.tgz \
  "https://github.com/$REPO/releases/download/v$VER/pico-host-$VER.tar.gz"
mkdir -p /opt/pico-workspace/releases/$VER
tar -C /opt/pico-workspace/releases/$VER --strip-components=1 -xzf /tmp/pico-host.tgz
(cd /opt/pico-workspace/releases/$VER && pnpm --filter "@pico/cli..." install --prod --frozen-lockfile)
ln -sfn /opt/pico-workspace/releases/$VER /opt/pico-workspace/current

# install the service: creates the pico-host user, the systemd units, the
# updater timer/path, seeds /etc/pico-host/env, and wires tailscale serve
node /opt/pico-workspace/current/packages/cli/dist/index.js \
  install --system --create-user --auto-update --tailscale-serve
```

`pico install --system` is idempotent: re-running it never clobbers
`/etc/pico-host/env`, and it only writes a unit drop-in when your paths/user/port
differ from the defaults baked into the checked-in unit. After this one-time
install, you never touch the box to ship — see [How shipping works](#how-shipping-works).

The flags are composable:

| Flag | Effect |
| --- | --- |
| `--system` | dedicated `pico-host` system user + systemd system service (vs. a per-user service) |
| `--create-user` | create the `pico-host` user if it doesn't exist |
| `--auto-update` | enable the periodic release-update timer (Linux + `--system` only) |
| `--tailscale-serve` | run `tailscale serve --bg --https=443 http://localhost:<port>` |

On a **laptop** the same CLI installs a per-user service instead: `npm i -g
@pico/cli`, then `pico install` (launchd on macOS, systemd-user on Linux) or just
`pico pair` to run a foreground host.

### Authenticate pi

For subscription login, authenticate as the same Unix user the service runs as:

```sh
cd /opt/pico-workspace/current/packages/host
sudo -u pico-host HOME=/var/lib/pico-host pnpm exec pi
# inside pi: /login, choose your provider, complete the flow, then /quit
```

This writes `/var/lib/pico-host/.pi/agent/auth.json`, where the service looks
because its `HOME` is `/var/lib/pico-host`. For API-key mode instead, set a
provider var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, …) in
`/etc/pico-host/env` and `systemctl restart pico-host`.

## Cloud-init (optional example)

For a hands-free boot, a VPS's cloud-init / user-data can install the prereqs
(Node, pnpm, git, Tailscale), `tailscale up` with a single-use preauthorized
auth key (tagged `tag:pico-host` if your ACL requires it), then run the
[first-time install](#first-time-install-one-time-per-box) steps. This is an
example to adapt, not a maintained script — keep the auth key single-use and
short-lived, since it can surface in cloud-init logs.

In production, pico-host defaults to `PI_AUTH_MODE=tailscale`: every REST route
except `/healthz` and every WebSocket upgrade must arrive through Tailscale Serve
with `Tailscale-User-Login`. The first successful setup from the mobile app
claims that Tailscale login as the Pico host owner in SQLite; subsequent requests
must come from the claimed owner.

## Releasing a new version

Cut a release from `main`:

```sh
pnpm release minor   # bump + changelog + commit + tag v<x.y.z> + push
```

The `v*` tag triggers `.github/workflows/pico-host-release.yml`, which builds
the prebuilt `dist/` + the compiled `host-update.mjs`, packages and signs the
artifact via `package-pico-host.sh`, and uploads:

```text
pico-host-<version>.tar.gz
pico-host-release.json        # signed manifest (version, protocol, sha256)
pico-host-release.json.sig
```

Signing requires `PICO_HOST_RELEASE_SIGNING_KEY_PEM` in Actions secrets; the
matching public key lives at `packages/host/deploy/update-public-key.pem` and is
installed to `/etc/pico-host/update-public-key.pem`.

**Test before promoting** with a prerelease tag (e.g. `v1.3.0-rc.1`): hyphenated
tags are marked prerelease, so GitHub's `releases/latest` excludes them and the
auto-updater never pulls an rc on its own. Place an rc on the box by hand (the
[first-time install](#first-time-install-one-time-per-box) steps with the rc
version) to smoke it before tagging the final.

## Release auto-updates

`host-update.mjs` (run by `pico-host-update.timer`, and on demand by
`pico-host-update.path`) downloads the latest GitHub Release manifest, verifies
its signature against the bundled public key, checks the artifact SHA-256,
extracts to `releases/<version>`, runs `pnpm install --prod`, atomically swaps
the `current` symlink, runs bundled SQLite migrations, restarts pico-host,
health-checks `/healthz`, and rolls the symlink back if the new version fails.
After a healthy update it refreshes its own copy and the unit files from the new
release.

Control the timer:

```sh
systemctl status pico-host-update.timer
systemctl start pico-host-update.service     # check now
systemctl disable --now pico-host-update.timer
```

The mobile app's Settings → "update now" button touches
`/var/lib/pico-host/update-request`, which `pico-host-update.path` watches and
runs the same signed, checksum-verified updater idempotently.

The Pico host applies additive SQLite migrations at startup; destructive schema
changes still require a deliberate table rebuild/backfill.

## Git workspaces on the box

The service is sandboxed so the agent's writable area is `/var/lib/pico-host`.
Clone repos under `/var/lib/pico-host/workspaces` — also the default root shown
by the mobile "choose directory" picker. If the picker shows nothing, the box
just has no repos there yet.

```sh
# public repo
sudo -u pico-host HOME=/var/lib/pico-host git clone \
  https://github.com/OWNER/REPO.git /var/lib/pico-host/workspaces/REPO

# private repo: create a key for the pico-host user, add it as a deploy key
sudo -u pico-host HOME=/var/lib/pico-host ssh-keygen -t ed25519 -C pico-host@YOURBOX -f /var/lib/pico-host/.ssh/id_ed25519
cat /var/lib/pico-host/.ssh/id_ed25519.pub   # add to GitHub/GitLab, then clone over git@
```

Set commit identity for agent-made commits:

```sh
sudo -u pico-host HOME=/var/lib/pico-host git config --global user.name "Pi Agent"
sudo -u pico-host HOME=/var/lib/pico-host git config --global user.email "pi-agent@YOURBOX"
```

## Tailscale serve

`pico install --tailscale-serve` configures this for you. To do it (or redo it)
by hand:

```sh
tailscale up                                            # if not already up
tailscale serve --bg --https=443 http://localhost:7777
tailscale serve status                                  # confirm the route + URL
```

The `tailscale serve status` URL (`https://<hostname>.<tailnet>.ts.net`) is what
goes into the mobile app.

## Mobile config

1. Install the Tailscale app on the phone, sign in to the same tailnet, and make
   sure "Use Tailscale DNS" is on so `…ts.net` names resolve.
2. Pair from the app (scan the QR from `pico pair-code` on the box), or set the
   tailnet HTTPS URL manually in Settings → "Pico host URL".
3. Pull-to-refresh on the session list to confirm the connection.

The mobile auto-upgrades `https://` → `wss://` for the WebSocket, so the single
URL covers both transports.

## Operations cheatsheet

```sh
journalctl -u pico-host -f                     # tail logs
journalctl -u pico-host -n 200 --no-pager      # recent logs
systemctl restart pico-host                     # restart
sudo $EDITOR /etc/pico-host/env && systemctl restart pico-host   # rotate a key
sqlite3 /var/lib/pico-host/pico-host.db '.tables'                # inspect state
systemctl stop pico-host                         # pause

# fully remove (irreversible — drops the DB and session JSONLs)
node /opt/pico-workspace/current/packages/cli/dist/index.js uninstall --system
rm -rf /opt/pico-workspace /var/lib/pico-host /etc/pico-host
userdel pico-host
```

## What this deploy does not do

- **No multi-user.** The host assumes a single human on the other side of the
  WS; anyone with the tailnet URL can drive any session.
- **No backups.** Snapshot `/var/lib/pico-host/` if the history matters — it's
  the SQLite DB plus pi's per-cwd JSONLs under `.pi/agent/sessions/`.
- **Limited migrations.** Additive only at startup; destructive schema changes
  need a deliberate rebuild/backfill.
- **No metrics.** Observability is "tail journalctl" until you add an exporter.

## Troubleshooting

**`systemctl is-active pico-host` reports `failed`.** Check
`journalctl -u pico-host -n 50`. Common causes: no provider auth for the
`pico-host` user, stale OAuth credentials, or quoted env values in
`/etc/pico-host/env`. For subscription auth, re-run the `pi /login` flow above.

**`pico-host-update.service` fails during the health check.** The updater
installed the release, restarted `pico-host`, then rolled back because `/healthz`
did not answer — the root cause is normally in the host unit, not the updater:

```sh
journalctl -u pico-host-update -n 120 --no-pager
journalctl -u pico-host -n 120 --no-pager
cat /var/lib/pico-host/update-state.json
```

Don't clear a failed version from `update-state.json` until the `pico-host` logs
explain why; otherwise the timer just retries and rolls back again.

**Mobile connects but `/healthz` 404s.** The `tailscale serve` route isn't
pointing at port 7777 — re-run the `tailscale serve` command and check
`tailscale serve status`.

**Mobile shows "host isn't ready yet" or "connecting" forever.** The Tailscale
app on the phone isn't connected (or "Use Tailscale DNS" is off), or the URL is
wrong — use the literal `tailscale serve status` output.

**WS close code 4004 on every reconnect.** The session id the mobile holds
doesn't exist on the host — pi's on-disk JSONL was removed, or you moved to a
fresh box. The mobile treats 4004 as terminal and shows "session no longer
available"; pull back to the list and start fresh.
