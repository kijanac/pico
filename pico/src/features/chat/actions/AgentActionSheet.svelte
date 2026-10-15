<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AgentActionView } from "./types";
  import * as Sheet from "@/shared/ui/sheet";

  const titles: Record<AgentActionView, string> = {
    settings: "session settings",
    tree: "conversation tree",
    info: "session info",
  };

  let {
    open = $bindable(false),
    view,
    error,
    children,
  }: {
    open: boolean;
    view: AgentActionView;
    error: string | null;
    children: Snippet;
  } = $props();
</script>

<Sheet.Root bind:open>
  <Sheet.BottomContent class="[--sheet-max-height:86dvh]">
    <Sheet.Header class="hairline-b flex-row items-center gap-1 space-y-0 px-2 py-2 pr-12 text-left">
      <Sheet.Title class="type-title min-w-0 flex-1 px-1 font-medium">{titles[view]}</Sheet.Title>
    </Sheet.Header>

    {#if error}
      <div class="type-meta mx-3 mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/8 px-3 py-2 text-[color:var(--color-danger)]">
        {error}
      </div>
    {/if}

    {@render children()}
  </Sheet.BottomContent>
</Sheet.Root>
