# pico-host deployment

Target shape: a single Hetzner (or any Linux) VPS reachable only over
Tailscale, running pico-host under systemd, with `tailscale serve`
providing the HTTPS endpoint the mobile app talks to.

## Why this shape

- **No public exposure.** The Pico host is intended to sit behind
  `tailscale serve`, not on the open internet. Binding to `127.0.0.1`
  keeps Tailscale Serve as the only ingress path, and production host
  requests require Tailscale identity headers from Serve.
- **HTTPS is solved.** iOS App Transport Security blocks plain HTTP,
  and the Capacitor WebView is no different. `tailscale serve` mints
  Let's Encrypt certs for `*.<your-tailnet>.ts.net` for free, so the
  mobile gets a proper `https://` URL with zero cert maintenance.
- **One box, one process.** A single-user Pico host doesn't need
  Docker, k8s, or load balancing. systemd + restart-on-failure is
  enough and stays diagnosable through `journalctl`.

## Prereqs

- A Linux VPS you can SSH into as root (Hetzner CX11 is plenty —
  ~$5/mo, 2 GB RAM, more than this needs).
- A Tailscale account; both the VPS and your phone joined to the same
  tailnet (you'll authenticate the VPS during install, the phone via
  the Tailscale iOS/Android app).
- Either a pi-supported subscription login — Claude Pro/Max, ChatGPT
  Plus/Pro/Codex, or GitHub Copilot — or a provider API key.
- SSH key auth set up (the install + deploy scripts assume `ssh` Just
  Works for the target host).

## Cloud-init (optional)

For a hands-free boot, point your VPS's cloud-init / user-data at `install.sh`:
clone this repo and run `packages/host/deploy/install.sh` with `TS_AUTHKEY`,
`PICO_HOSTNAME`, `TAILSCALE_SERVE=1`, `PICO_HOST_AUTO_DEPLOY=1`, and
`PICO_HOST_AUTO_UPDATE=1`. Use a single-use, preauthorized Tailscale auth key
(tagged `tag:pico-host` if your tailnet ACL requires it); on first boot it joins
your tailnet, installs pico-host, starts the systemd service, and runs
`tailscale serve`. The auth key can surface in cloud-init logs, so keep it
single-use and short-lived.

Prefer to do it by hand? SSH into the VPS and run `install.sh` directly.

In production, pico-host defaults to `PI_AUTH_MODE=tailscale`: every REST route
except `/healthz` and every WebSocket upgrade must arrive through Tailscale Serve
with `Tailscale-User-Login`. The first successful setup from the mobile app
claims that Tailscale login as the Pico host owner in SQLite; subsequent requests
must come from the claimed owner.

## First-time install — on the server

```sh
# from the repository root on your laptop
scp -r packages/host/deploy/ root@YOURBOX:/tmp/pico-host-deploy/
ssh root@YOURBOX 'bash /tmp/pico-host-deploy/install.sh'
```

`install.sh` is idempotent — re-running it is safe (won't clobber
`/etc/pico-host/env`). It:

1. Creates the `pico-host` system user, `/opt/pico-workspace` source dir,
   `/var/lib/pico-host` data dir, and `/var/lib/pico-host/workspaces` for git repos.
2. Installs node 26.1+ (NodeSource), pnpm 10.5.2 (via corepack), git,
   and tailscale (via the official install script) if any are missing.
3. Drops the systemd unit, enables it (doesn't start it yet).
4. Seeds `/etc/pico-host/env` from `env.example` *only if it doesn't
   already exist*.

After it finishes, authenticate pi for the same Unix user the systemd service
runs as. For subscription login, deploy the source first if you have not yet,
then run:

```sh
ssh root@YOURBOX
cd /opt/pico-workspace/current/packages/host
sudo -u pico-host HOME=/var/lib/pico-host pnpm exec pi
# inside pi: /login, choose Claude / OpenAI Codex / GitHub Copilot,
# complete the browser or device-code flow, then /quit
```

This writes credentials to `/var/lib/pico-host/.pi/agent/auth.json`, which is
where the service looks because its `HOME` is `/var/lib/pico-host`.

For API-key mode instead, edit `/etc/pico-host/env` and set a provider env var
such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`.

## Deploy the source — from your laptop

```sh
# from the repository root
PICO_DEPLOY_HOST=root@YOURBOX ./packages/host/deploy/deploy.sh
```

If this is your first deploy and you want subscription auth, run the `pi /login`
command above after this deploy, then restart once more:

```sh
ssh root@YOURBOX 'systemctl restart pico-host'
```

This rsyncs the workspace pieces the Pico host needs — root pnpm metadata,
`packages/host/`, and `packages/` — to `/opt/pico-workspace`, runs a filtered
production install for `pico-host` and its workspace dependencies, restarts the
service, and hits `/healthz` to confirm the boot succeeded.

`node_modules/`, build outputs, tarballs, and local scratch files are excluded.
The mobile source is not deployed to the server; the box only runs the Pico host.

Re-run this script for manual deploys. Self-service installs can instead
use the release updater described below.

## Release auto-updates

Professional self-service installs use versioned Pico host releases:

```text
/opt/pico-workspace/releases/<version>
/opt/pico-workspace/current -> releases/<version>
```

`pico-host.service` runs from `current/packages/host`. The updater downloads the
latest GitHub Release manifest, verifies its signature when configured,
checks the artifact SHA-256 from that manifest, extracts to a new release
directory, switches the `current` symlink, restarts the Pico host, health-checks
`/healthz`, and rolls back the symlink if the new version fails.

Release assets are produced by:

```sh
packages/host/deploy/package-pico-host.sh 0.2.2
```

The GitHub workflow `.github/workflows/pico-host-release.yml` runs this for
`v*` tags and uploads:

```text
pico-host-<version>.tar.gz
pico-host-release.json
pico-host-release.json.sig
```

Set `PICO_HOST_RELEASE_SIGNING_KEY_PEM` in GitHub Actions secrets to sign the
manifest. The matching public key is bundled at
`packages/host/deploy/update-public-key.pem` and installed to:

```text
/etc/pico-host/update-public-key.pem
```

The installer writes `PICO_HOST_AUTO_UPDATE=1` to `/etc/pico-host/env` when
auto-update is enabled. Release repository, channel, public key path, install
path, and health-check target are product-owned by `update.sh`.

Control the timer with:

```sh
systemctl status pico-host-update.timer
systemctl start pico-host-update.service     # check now
systemctl disable --now pico-host-update.timer
```

For the message-usage wire-shape migration, release updates run the bundled
SQLite migration before restarting the Pico host. If you need a one-shot manual
server command after publishing a release, run:

```sh
systemctl start pico-host-update.service && \
  systemctl stop pico-host && \
  node /opt/pico-workspace/current/packages/host/deploy/migrate-message-usage-shape.mjs /var/lib/pico-host/pico-host.db && \
  systemctl start pico-host && \
  curl -fsS http://127.0.0.1:7777/healthz
```

The migration is idempotent and intentionally does not create a DB backup.

The installer also enables `pico-host-update.path`. The mobile app's
Settings → `update now` button touches `/var/lib/pico-host/update-request`,
which triggers the same signed, checksum-verified updater idempotently.

The Pico host uses additive SQLite migrations at startup. Destructive schema
changes still require a deliberate table rebuild/backfill.

## Git workspaces on the box

The Pico host service is sandboxed so the agent's writable area is
`/var/lib/pico-host`. Clone repos under:

```text
/var/lib/pico-host/workspaces
```

That directory is also the default root shown by the mobile "choose directory"
picker. If the picker shows no project folders, the box simply has no repos
there yet.

For public repos:

```sh
ssh root@YOURBOX
sudo -u pico-host HOME=/var/lib/pico-host git clone \
  https://github.com/OWNER/REPO.git \
  /var/lib/pico-host/workspaces/REPO
```

For private repos, create an SSH key for the `pico-host` user and add its
public key as a GitHub/GitLab deploy key or account key:

```sh
ssh root@YOURBOX
sudo -u pico-host HOME=/var/lib/pico-host ssh-keygen -t ed25519 -C pico-host@YOURBOX -f /var/lib/pico-host/.ssh/id_ed25519
cat /var/lib/pico-host/.ssh/id_ed25519.pub
# add that public key to GitHub/GitLab, then:
sudo -u pico-host HOME=/var/lib/pico-host ssh -T git@github.com
sudo -u pico-host HOME=/var/lib/pico-host git clone \
  git@github.com:OWNER/REPO.git \
  /var/lib/pico-host/workspaces/REPO
```

Set commit identity for agent-made commits:

```sh
sudo -u pico-host HOME=/var/lib/pico-host git config --global user.name "Pi Agent"
sudo -u pico-host HOME=/var/lib/pico-host git config --global user.email "pi-agent@YOURBOX"
```

## Tailscale serve — one time per box

`tailscale serve` is what gives the mobile a working `https://` URL
backed by a real Let's Encrypt cert.

```sh
ssh root@YOURBOX
tailscale up                                            # if not already up
tailscale cert  $(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')
tailscale serve --bg --https=443 http://localhost:7777
tailscale serve status                                  # confirm the route
```

The output of `tailscale serve status` shows the public URL — something
like `https://<hostname>.<tailnet>.ts.net`. That's what the mobile app
goes into.

## Mobile config

1. Install the Tailscale app on the phone, sign in to the same tailnet
   as the VPS.
2. Open Pico → Settings → set "Pico host URL" to the tailnet HTTPS
   URL from the previous step.
3. Pull-to-refresh on the session list to confirm the connection.

The mobile's `connectStream` auto-upgrades `https://` → `wss://` for
the WebSocket, so the single setting covers both transports.

## Operations cheatsheet

```sh
# logs (tail)
journalctl -u pico-host -f

# logs (last 200 lines)
journalctl -u pico-host -n 200 --no-pager

# restart
systemctl restart pico-host

# rotate the Anthropic key
sudo $EDITOR /etc/pico-host/env && systemctl restart pico-host

# inspect state
ls -la /var/lib/pico-host/                              # sqlite db + pi sessions
sqlite3 /var/lib/pico-host/pico-host.db '.tables'

# disable temporarily
systemctl stop pico-host

# fully remove (irreversible — drops the DB and session JSONLs)
systemctl disable --now pico-host
rm -rf /opt/pico-workspace /var/lib/pico-host /etc/pico-host /etc/systemd/system/pico-host.service
systemctl daemon-reload
userdel pico-host
```

## What this deploy does not do

- **No multi-user.** The Pico host assumes a single human is on the other
  side of the WS. There's no user identity in the protocol; anyone
  with the tailnet URL can drive any session.
- **No backups.** Snapshot `/var/lib/pico-host/` if the conversation
  history matters to you — it's the SQLite DB plus pi's per-cwd JSONLs
  under `.pi/agent/sessions/`.
- **Limited migrations.** Additive SQLite migrations run at Pico host startup.
  Destructive schema changes still need a deliberate table rebuild/backfill.
- **No metrics.** If you want Prometheus/etc., add an exporter. Right
  now observability is "tail journalctl".

## Troubleshooting

**`systemctl is-active pico-host` reports `failed`.** Check
`journalctl -u pico-host -n 50`. Common causes: no provider auth for the
`pico-host` user, stale OAuth credentials, or quoted env values in
`/etc/pico-host/env` for API-key mode. For subscription auth, re-run:

```sh
cd /opt/pico-workspace/current/packages/host
sudo -u pico-host HOME=/var/lib/pico-host pnpm exec pi
```

then use `/login` or `/model` as needed.

**`pico-host-update.service` fails during the health check.** The updater
installed the release, restarted `pico-host`, then rolled back because
`/healthz` did not answer. The root cause is normally in the Pico host unit, not
the updater unit:

```sh
journalctl -u pico-host-update -n 120 --no-pager
journalctl -u pico-host -n 120 --no-pager
systemctl status pico-host --no-pager
cat /var/lib/pico-host/update-state.json
```

Do not clear a failed version from `update-state.json` until the `pico-host`
logs explain why it failed; otherwise the timer will just retry and roll back
again.

**Mobile connects but `/healthz` 404s.** The `tailscale serve` route
isn't pointing at port 7777 — re-run the `tailscale serve` command
and check `tailscale serve status`.

**Mobile shows "connecting" forever.** The Tailscale app on the phone
isn't connected to the tailnet, or the tailnet name in the URL is
wrong (use the literal output from `tailscale serve status`, not what
you remember it being).

**WS close code 4004 on every reconnect.** The session id the mobile
is holding doesn't exist on the Pico host — either pi's on-disk JSONL was
removed under `/var/lib/pico-host/.pi/`, or you deployed onto a fresh
box and the mobile is still trying to resume an old session id. The
mobile recognizes 4004 as terminal and shows the "session no longer
available" pane; pull back to the list and start fresh.
