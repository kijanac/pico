import { A } from "@solidjs/router";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { Check, Copy, Loader2, X } from "lucide-solid";
import { PRODUCT_VERSION, PROTOCOL_VERSION, renderBridgeCloudInit, type SystemInfo } from "@pi-mobile/protocol";
import EdgeSwipeBack from "@/components/EdgeSwipeBack";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea } from "@/components/ui/text-field";
import SessionsPreview from "@/features/sessions/components/SessionsPreview";
import { claimBridge, getBridgeIdentity, getSystemInfo, healthcheck, type BridgeIdentity } from "@/lib/api";
import { KeyboardAvoidance } from "@/lib/keyboard";
import { getBridgeUrl, setBridgeUrl } from "@/lib/settings";

type Probe = "idle" | "checking" | "ok" | "fail";

function randomBridgeHostname(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `pi-bridge-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function compareVersion(a: string, b: string): number {
  const aa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
    const diff = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default function Settings() {
  const [url, setUrl] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const [probe, setProbe] = createSignal<Probe>("idle");
  const [systemInfo, setSystemInfo] = createSignal<SystemInfo | null>(null);
  const [systemInfoError, setSystemInfoError] = createSignal<string | null>(null);
  const [bridgeIdentity, setBridgeIdentity] = createSignal<BridgeIdentity | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);

  const [tsAuthKey, setTsAuthKey] = createSignal("");
  const [bridgeHostname, setBridgeHostname] = createSignal("");
  const [tailnet, setTailnet] = createSignal("");

  onMount(async () => {
    setUrl(await getBridgeUrl());
    setBridgeHostname(randomBridgeHostname());
  });

  const computedBridgeUrl = createMemo(() => {
    const host = bridgeHostname().trim();
    const suffix = tailnet().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    return host && suffix ? `https://${host}.${suffix}` : "";
  });

  const compatibility = createMemo(() => {
    const info = systemInfo();
    if (!info) return null;
    if (info.protocolVersion !== PROTOCOL_VERSION) {
      return {
        level: "danger" as const,
        text: `protocol mismatch: mobile ${PROTOCOL_VERSION}, bridge ${info.protocolVersion}`,
      };
    }
    if (compareVersion(PRODUCT_VERSION, info.minMobileVersion) < 0) {
      return {
        level: "danger" as const,
        text: `mobile ${PRODUCT_VERSION} is too old for this bridge`,
      };
    }
    if (compareVersion(PRODUCT_VERSION, info.recommendedMobileVersion) < 0) {
      return {
        level: "warn" as const,
        text: `mobile update recommended: ${info.recommendedMobileVersion}`,
      };
    }
    return { level: "ok" as const, text: "compatible" };
  });

  const cloudInit = createMemo(() =>
    renderBridgeCloudInit({
      tsAuthKey: tsAuthKey(),
      bridgeHostname: bridgeHostname(),
    }),
  );

  async function test() {
    setProbe("checking");
    setSystemInfo(null);
    setSystemInfoError(null);
    setBridgeIdentity(null);
    const base = url().trim();
    const ok = await healthcheck(base);
    setProbe(ok ? "ok" : "fail");
    if (!ok) return;
    try {
      setSystemInfo(await getSystemInfo(base));
      const identity = await getBridgeIdentity(base);
      if (!identity.claimed) {
        const claimed = await claimBridge(base);
        setBridgeIdentity({ user: claimed.owner, claimed: true });
      } else {
        setBridgeIdentity(identity);
      }
    } catch (error) {
      setSystemInfoError(error instanceof Error ? error.message : String(error));
    }
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
    <EdgeSwipeBack href="/" preview={<SessionsPreview />}>
      <KeyboardAvoidance mode="manual">
        <Header back="/" title="settings" />

        <div
          class="min-h-0 flex-1 space-y-7 overflow-y-auto px-3 pt-4"
          style={{ "padding-bottom": "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          <section>
            <label class="label mb-1.5 block" for="bridge_url">
              bridge url
            </label>
            <div class="flex items-stretch gap-1.5">
              <TextField class="flex-1">
                <TextFieldInput
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
                  class="text-[13px]"
                />
              </TextField>
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

            <Show when={systemInfo()}>
              {(info) => (
                <div class="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-2 text-[11px] leading-relaxed text-[color:var(--color-fg-muted)]">
                  <div class="flex items-center justify-between gap-2">
                    <span>bridge {info().bridgeVersion}</span>
                    <span
                      class={
                        compatibility()?.level === "danger"
                          ? "text-[color:var(--color-danger)]"
                          : compatibility()?.level === "warn"
                            ? "text-[color:var(--color-warning,#d97706)]"
                            : "text-[color:var(--color-accent)]"
                      }
                    >
                      {compatibility()?.text}
                    </span>
                  </div>
                  <div class="mt-1">
                    protocol {info().protocolVersion} · updates {info().autoUpdate ? "on" : "off"} ·{" "}
                    {info().updateChannel}
                  </div>
                  <Show when={bridgeIdentity()}>
                    {(identity) => (
                      <div class="mt-1">
                        tailscale owner {identity().user} · {identity().claimed ? "claimed" : "unclaimed"}
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={systemInfoError()}>
              <div class="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-2 text-[11px] leading-relaxed text-[color:var(--color-fg-faint)]">
                bridge is reachable, but does not expose system info yet. likely an older bridge.
              </div>
            </Show>

            <Button type="button" variant="default" onClick={save} class="mt-6 w-full bg-[color:var(--color-accent)] text-[color:var(--color-bg)] hover:bg-[color:var(--color-accent)] active:opacity-80">
              {saved() ? "saved ✓" : "save"}
            </Button>
          </section>

          <section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
            <div class="mb-3">
              <h2 class="text-[13px] font-medium text-[color:var(--color-fg)]">
                guided bridge onboarding
              </h2>
              <p class="mt-1 text-[11px] leading-relaxed text-[color:var(--color-fg-faint)]">
                generate cloud-init, provision a fresh box, then let pi-mobile wait for and claim the bridge.
              </p>
            </div>
            <A href="/onboarding" class="block rounded-[var(--radius-md)] bg-[color:var(--color-accent)] px-3 py-3 text-center text-[13px] font-medium text-[color:var(--color-bg)] active:opacity-80">
              start onboarding
            </A>
          </section>

          <section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
            <div class="mb-3">
              <h2 class="text-[13px] font-medium text-[color:var(--color-fg)]">
                advanced cloud-init bridge setup
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

            <TextField class="mt-4">
              <TextFieldLabel for="cloud_init">cloud-init</TextFieldLabel>
              <TextFieldTextArea
                id="cloud_init"
                readonly
                value={cloudInit()}
                rows={13}
                class="min-h-0 resize-none bg-[color:var(--color-bg)] font-mono text-[10.5px] leading-relaxed"
              />
            </TextField>

            <Button
              type="button"
              variant="outline"
              onClick={() => copy(cloudInit(), "cloud-init")}
              class="mt-2 w-full border-[color:var(--color-border-strong)] active:bg-[color:var(--color-bg)]"
            >
              <Copy size={14} />
              {copied() === "cloud-init" ? "copied ✓" : "copy cloud-init"}
            </Button>
          </section>
        </div>
      </KeyboardAvoidance>
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
}) {
  return (
    <TextField>
      <TextFieldLabel for={props.id}>{props.label}</TextFieldLabel>
      <TextFieldInput
        id={props.id}
        type={props.secret ? "password" : "text"}
        autocapitalize="none"
        autocorrect="off"
        spellcheck={false}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        class="bg-[color:var(--color-bg)] text-[12px]"
      />
    </TextField>
  );
}
