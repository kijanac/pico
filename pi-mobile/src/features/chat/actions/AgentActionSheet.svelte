<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChevronLeft } from "@lucide/svelte";
  import type { AgentActionView } from "./types";
  import { Button } from "@/shared/ui/button";
  import * as Sheet from "@/shared/ui/sheet";

  const titles: Record<AgentActionView, string> = {
    menu: "agent",
    models: "model",
    compact: "compact context",
    settings: "session settings",
    tree: "tree",
    auth: "providers",
    info: "session info",
  };

  let {
    open = $bindable(false),
    view,
    error,
    onBack,
    children,
  }: {
    open: boolean;
    view: AgentActionView;
    error: string | null;
    onBack: () => void;
    children: Snippet;
  } = $props();
</script>

<Sheet.Root bind:open>
  <Sheet.Content
    side="bottom"
    class="flex max-h-[86dvh] flex-col gap-0 overflow-hidden rounded-t-[12px] border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] p-0 text-[color:var(--color-fg)] shadow-none"
    style="padding-bottom: calc(env(safe-area-inset-bottom) + var(--keyboard-bottom-inset, 0px) + 0.5rem)"
  >
    <Sheet.Header class="hairline-b flex-row items-center gap-1 space-y-0 px-2 py-2 pr-12 text-left">
      {#if view !== "menu"}
        <Button type="button" variant="ghost" size="icon" onclick={onBack} aria-label="Back" class="rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] hover:bg-transparent active:bg-[color:var(--color-surface)]">
          <ChevronLeft class="size-4" />
        </Button>
      {:else}
        <div class="h-9 w-9" aria-hidden="true"></div>
      {/if}
      <Sheet.Title class="min-w-0 flex-1 px-1 text-[13px] font-medium">{titles[view]}</Sheet.Title>
    </Sheet.Header>

    {#if error}
      <div class="mx-3 mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[11px] text-[color:var(--color-danger)]">
        {error}
      </div>
    {/if}

    {@render children()}
  </Sheet.Content>
</Sheet.Root>
