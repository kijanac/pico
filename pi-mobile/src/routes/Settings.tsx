import { createSignal, onMount, Show, type JSX } from "solid-js";
import { Check, X, Loader2 } from "lucide-solid";
import EdgeSwipeBack from "~/components/EdgeSwipeBack";
import Header from "~/components/Header";
import { getBridgeUrl, setBridgeUrl } from "~/lib/settings";
import { healthcheck } from "~/lib/api";

type Probe = "idle" | "checking" | "ok" | "fail";

export default function Settings(): JSX.Element {
  const [url, setUrl] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const [probe, setProbe] = createSignal<Probe>("idle");

  onMount(async () => {
    setUrl(await getBridgeUrl());
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

  return (
    <EdgeSwipeBack href="/">
      <div class="flex min-h-dvh flex-col">
        <Header back="/" title="settings" />

        <div class="flex-1 px-3 py-4">
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
          . for local dev, the default <span class="text-[color:var(--color-fg-muted)]">http://localhost:7777</span> works.
        </p>

        <button
          type="button"
          onClick={save}
          class="mt-6 flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--color-accent)] text-[12px] font-medium text-[color:var(--color-bg)] active:opacity-80"
        >
          {saved() ? "saved ✓" : "save"}
        </button>
        </div>
      </div>
    </EdgeSwipeBack>
  );
}
