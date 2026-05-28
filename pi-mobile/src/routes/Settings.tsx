import { createMemo, createSignal, onMount, Show, type JSX } from "solid-js";
import { Check, Copy, Loader2, X } from "lucide-solid";
import EdgeSwipeBack from "~/components/EdgeSwipeBack";
import Header from "~/components/Header";
import { healthcheck } from "~/lib/api";
import { getBridgeUrl, setBridgeUrl } from "~/lib/settings";

type Probe = "idle" | "checking" | "ok" | "fail";

const DEFAULT_REPO_URL = "https://github.com/kijanac/pi-mobile.git";

function randomBridgeHostname(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `pi-bridge-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export default function Settings(): JSX.Element {
  const [url, setUrl] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const [probe, setProbe] = createSignal<Probe>("idle");
  const [copied, setCopied] = createSignal<string | null>(null);

  const [tsAuthKey, setTsAuthKey] = createSignal("");
  const [bridgeHostname, setBridgeHostname] = createSignal("");
  const [tailnet, setTailnet] = createSignal("");
  const [repoUrl, setRepoUrl] = createSignal(DEFAULT_REPO_URL);

  onMount(async () => {
    setUrl(await getBridgeUrl());
    setBridgeHostname(randomBridgeHostname());
  });

  const computedBridgeUrl = createMemo(() => {
    const host = bridgeHostname().trim();
    const suffix = tailnet().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    return host && suffix ? `https://${host}.${suffix}` : "";
  });

  const cloudInit = createMemo(() => {
    const lines = [
      "#cloud-config",
      "package_update: true",
      "packages:",
      "  - ca-certificates",
      "  - curl",
      "  - git",
      "runcmd:",
      "  - |",
      "    set -euo pipefail",
      `    export TS_AUTHKEY=${shellQuote(tsAuthKey().trim())}`,
      `    export BRIDGE_HOSTNAME=${shellQuote(bridgeHostname().trim())}`,
      "    export TAILSCALE_TAG=tag:pi-bridge",
      "    export TAILSCALE_SERVE=1",
      "    export PI_BRIDGE_AUTO_DEPLOY=1",
    ];

    lines.push(
      "    rm -rf /tmp/pi-mobile",
      `    git clone --depth=1 ${shellQuote(repoUrl().trim() || DEFAULT_REPO_URL)} /tmp/pi-mobile`,
      "    /tmp/pi-mobile/bridge/deploy/install.sh",
    );

    return `${lines.join("\n")}\n`;
  });

  async function test() {
    setProbe("checking");
    const ok = await healthcheck(url().trim());
    setProbe(ok ? "ok" : "fail");
  }

  async function save() {
    await setBridgeUrl(url());
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }

  function useComputedUrl() {
    const next = computedBridgeUrl();
    if (!next) return;
    setUrl(next);
    setProbe("idle");
    setSaved(false);
  }

  return (
    <EdgeSwipeBack href="/">
      <div class="flex min-h-dvh flex-col">
        <Header back="/" title="settings" />

        <div class="flex-1 space-y-7 px-3 py-4">
          <section>
            <label class="label mb-1.5 block" for="bridge_url">
              bridge url
            </label>
            <div class="flex items-stretch gap-1.5">
              <input
                id="bridge_url"
                type="url"
                inputmode="url"
                autocapitalize="none"
                autocorrect="off"
                spellcheck={false}
                value={url()}
                onInput={(e) => {
                  setUrl(e.currentTarget.value);
                  setProbe("idle");
                  setSaved(false);
                }}
                placeholder="http://localhost:7777"
                class="flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[13px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:border-[color:var(--color-border-strong)] focus:outline-none"
              />
              <button
                type="button"
                onClick={test}
                class="flex w-12 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] active:bg-[color:var(--color-surface)]"
                aria-label="Test connection"
              >
                <Show
                  when={probe() !== "checking"}
                  fallback={
                    <Loader2
                      size={14}
                      class="text-[color:var(--color-fg-muted)]"
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                  }
                >
                  <Show when={probe() === "ok"}>
                    <Check size={14} class="text-[color:var(--color-accent)]" />
                  </Show>
                  <Show when={probe() === "fail"}>
                    <X size={14} class="text-[color:var(--color-danger)]" />
                  </Show>
                  <Show when={probe() === "idle"}>
                    <span class="text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-fg-muted)]">
                      test
                    </span>
                  </Show>
                </Show>
              </button>
            </div>

            <p class="mt-2 text-[11px] leading-relaxed text-[color:var(--color-fg-faint)]">
              on tailscale, this will look like{" "}
              <span class="text-[color:var(--color-fg-muted)]">
                https://agent.tail-xxxx.ts.net
              </span>
              . for local dev, the default{" "}
              <span class="text-[color:var(--color-fg-muted)]">http://localhost:7777</span> works.
            </p>

            <button
              type="button"
              onClick={save}
              class="mt-6 flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[12px] font-medium text-[color:var(--color-bg)] active:opacity-80"
            >
              {saved() ? "saved ✓" : "save"}
            </button>
          </section>

          <section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
            <div class="mb-3">
              <h2 class="text-[13px] font-medium text-[color:var(--color-fg)]">
                generate cloud-init bridge setup
              </h2>
              <p class="mt-1 text-[11px] leading-relaxed text-[color:var(--color-fg-faint)]">
                create a single-use, preauthorized Tailscale auth key, paste it here,
                then paste the generated cloud-init into your VPS provider.
              </p>
            </div>

            <div class="space-y-3">
              <Field
                id="ts_auth_key"
                label="tailscale auth key"
                value={tsAuthKey()}
                onInput={setTsAuthKey}
                placeholder="tskey-auth-..."
                secret
              />
              <Field
                id="bridge_hostname"
                label="bridge hostname"
                value={bridgeHostname()}
                onInput={setBridgeHostname}
                placeholder="pi-bridge-ab12cd"
              />
              <Field
                id="tailnet"
                label="tailnet dns suffix"
                value={tailnet()}
                onInput={setTailnet}
                placeholder="tail-xxxx.ts.net"
              />
              <Field
                id="repo_url"
                label="repo url"
                value={repoUrl()}
                onInput={setRepoUrl}
                placeholder={DEFAULT_REPO_URL}
              />
            </div>

            <Show when={computedBridgeUrl()}>
              <div class="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[11px] text-[color:var(--color-fg-muted)]">
                bridge URL: {computedBridgeUrl()}
                <button
                  type="button"
                  onClick={useComputedUrl}
                  class="ml-2 text-[color:var(--color-accent)] active:opacity-70"
                >
                  use
                </button>
              </div>
            </Show>

            <label class="label mt-4 block" for="cloud_init">
              cloud-init
            </label>
            <textarea
              id="cloud_init"
              readonly
              value={cloudInit()}
              rows={13}
              class="mt-1 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-[color:var(--color-fg)] focus:outline-none"
            />

            <button
              type="button"
              onClick={() => copy(cloudInit(), "cloud-init")}
              class="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] font-medium active:bg-[color:var(--color-bg)]"
            >
              <Copy size={14} />
              {copied() === "cloud-init" ? "copied ✓" : "copy cloud-init"}
            </button>
          </section>
        </div>
      </div>
    </EdgeSwipeBack>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
  secret?: boolean;
}): JSX.Element {
  return (
    <div>
      <label class="label mb-1 block" for={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.secret ? "password" : "text"}
        autocapitalize="none"
        autocorrect="off"
        spellcheck={false}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        class="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-[12px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] focus:border-[color:var(--color-border-strong)] focus:outline-none"
      />
    </div>
  );
}
