<script lang="ts">
  import { Info, ListTree, Settings } from "@lucide/svelte";

  let {
    onModels,
    onCompact,
    onSettings,
    onTree,
    onInfo,
    onAuth,
  }: {
    onModels: () => void;
    onCompact: () => void;
    onSettings: () => void;
    onTree: () => void;
    onInfo: () => void;
    onAuth: () => void;
  } = $props();
</script>

<div class="space-y-2 px-3 py-3">
  {@render MenuButton("provider sign-in", "configure model provider auth from the phone", onAuth)}
  {@render MenuButton("model", "choose the model for this session", onModels)}
  {@render MenuButton("compact context", "summarize older context for future turns", onCompact)}
  {@render MenuButton("tree", "branch from an earlier point in this conversation", onTree, "tree")}
  {@render MenuButton("session settings", "model, thinking, queueing, compaction, and retry behavior", onSettings, "settings")}
  {@render MenuButton("session info", "file, tokens, cost, and message counts", onInfo, "info")}
</div>

{#snippet MenuButton(title: string, description: string, onClick: () => void, icon?: "tree" | "settings" | "info")}
  <button type="button" onclick={onClick} class="hairline-b flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)]">
    {#if icon}
      <span class="mt-0.5 text-[color:var(--color-fg-muted)]">
        {#if icon === "tree"}<ListTree class="size-3.5" />{:else if icon === "settings"}<Settings class="size-3.5" />{:else}<Info class="size-3.5" />{/if}
      </span>
    {/if}
    <span class="min-w-0 flex-1">
      <span class="block text-[12.5px] font-medium">{title}</span>
      <span class="block text-[11px] text-[color:var(--color-fg-muted)]">{description}</span>
    </span>
  </button>
{/snippet}
