<script lang="ts">
  import { tick } from "svelte";
  import { useSessionSettings } from "../actions/use-session-settings.svelte";
  import SessionSettingsView from "../actions/SessionSettingsView.svelte";
  import ProvidersPanel from "@/features/auth/ProvidersPanel.svelte";
  import SheetHeader from "@/shared/components/SheetHeader.svelte";
  import * as Sheet from "@/shared/ui/sheet";
  import { composerControls } from "./composer-controls";

  let { sessionId, onpointerdown }: { sessionId: string; onpointerdown: (event: PointerEvent) => void } = $props();
  let open = $state(false);
  let view = $state<"model" | "thinking" | "providers">("model");
  let providersVisited = $state(false);
  let error = $state<string | null>(null);
  let providerTrigger = $state<HTMLButtonElement | null>(null);
  let backRef = $state<HTMLElement | null>(null);
  const settings = useSessionSettings(() => sessionId, (message) => (error = message));
  const labels = $derived(composerControls(settings.settings));

  function show(next: "model" | "thinking"): void {
    view = next;
    providersVisited = false;
    error = null;
    open = true;
  }

  async function showProviders(): Promise<void> {
    providersVisited = true;
    view = "providers";
    await tick();
    backRef?.focus({ preventScroll: true });
  }

  async function backToModel(): Promise<void> {
    view = "model";
    error = null;
    void settings.reload();
    await tick();
    providerTrigger?.focus({ preventScroll: true });
  }
</script>

<div class="flex min-w-0 flex-1 items-center">
  <button type="button" {onpointerdown} onclick={() => show("model")} class="touch-target type-meta min-w-11 shrink rounded-[var(--radius-sm)] px-1.5 py-1.5 text-left text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label="Model — tap to change" title={`Change model · ${labels.model}`}>
    <span class="block truncate">{labels.model}</span>
  </button>
  {#if labels.thinking !== null}
    <button type="button" {onpointerdown} onclick={() => show("thinking")} class="touch-target type-meta min-w-11 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] px-1.5 py-1.5 text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface-2)]" aria-label={`Thinking level ${labels.thinking} — tap to change`} title={`Thinking level · ${labels.thinking}`}>
      {labels.thinking}
    </button>
  {/if}
</div>

<Sheet.Root bind:open>
  <Sheet.BottomContent class={view === "thinking" ? "[--sheet-max-height:82dvh]" : "h-[min(82dvh,var(--sheet-available-height))] [--sheet-max-height:82dvh]"}>
    {#if view === "model"}
      <Sheet.Header class="hairline-b h-12 shrink-0 flex-row items-center gap-2 space-y-0 px-3 pr-12 text-left">
        <Sheet.Title class="type-title font-prose min-w-0 flex-1 px-1 font-medium">model</Sheet.Title>
        <button bind:this={providerTrigger} type="button" onclick={showProviders} class="type-meta min-h-11 shrink-0 px-1 text-[color:var(--color-fg-muted)] active:opacity-70">manage providers</button>
      </Sheet.Header>
    {:else}
      <SheetHeader title={view} onBack={view === "providers" ? backToModel : undefined} backLabel="Back to model" bind:backRef />
    {/if}
    <div class={view === "providers" ? "hidden" : "flex min-h-0 flex-1 flex-col"} style:container-type={view === "model" ? "size" : undefined} style:container-name={view === "model" ? "model-picker" : undefined}>
      {#if error}
        <p class="type-meta px-3 pt-2 text-[color:var(--color-danger)]" role="alert">{error}</p>
      {/if}
      <SessionSettingsView {sessionId} onError={(message) => (error = message)} filterKeys={view === "thinking" ? ["thinkingLevel"] : ["model"]} hideLabels={view === "thinking"} />
    </div>
    {#if providersVisited}
      <div class={view === "providers" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <ProvidersPanel />
      </div>
    {/if}
  </Sheet.BottomContent>
</Sheet.Root>
