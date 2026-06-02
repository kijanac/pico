<script lang="ts">
  import { Archive, Info, KeyRound, ListTree, Settings, SlidersHorizontal } from "@lucide/svelte";

  let {
    onModels,
    onAuth,
    onCompact,
    onTree,
    onSettings,
    onInfo,
  }: {
    onModels: () => void;
    onAuth: () => void;
    onCompact: () => void;
    onTree: () => void;
    onSettings: () => void;
    onInfo: () => void;
  } = $props();
</script>

<div class="space-y-2 px-3 py-3">
  {@render MenuButton("model", "choose the model for this session", onModels, "model")}
  {@render MenuButton("providers", "configure model provider auth", onAuth, "auth")}

  <div class="label px-1 pt-2">context</div>
  {@render MenuButton("compact", "summarize older context for future turns", onCompact, "compact")}
  {@render MenuButton("tree", "branch from an earlier point in this conversation", onTree, "tree")}

  <div class="label px-1 pt-2">session</div>
  {@render MenuButton("settings", "thinking, queueing, compaction, and retry behavior", onSettings, "settings")}
  {@render MenuButton("info", "file, cwd, tokens, cost, and message counts", onInfo, "info")}
</div>

{#snippet MenuButton(title: string, description: string, onClick: () => void, icon: "model" | "auth" | "compact" | "tree" | "settings" | "info")}
  <button type="button" onclick={onClick} class="hairline-b flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)]">
    <span class="mt-0.5 text-[color:var(--color-fg-muted)]">
      {#if icon === "model"}<SlidersHorizontal class="size-3.5" />{:else if icon === "auth"}<KeyRound class="size-3.5" />{:else if icon === "compact"}<Archive class="size-3.5" />{:else if icon === "tree"}<ListTree class="size-3.5" />{:else if icon === "settings"}<Settings class="size-3.5" />{:else}<Info class="size-3.5" />{/if}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block text-[12.5px] font-medium">{title}</span>
      <span class="block text-[11px] text-[color:var(--color-fg-muted)]">{description}</span>
    </span>
  </button>
{/snippet}
