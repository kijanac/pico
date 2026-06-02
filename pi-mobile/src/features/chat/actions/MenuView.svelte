<script lang="ts">
  import { Archive, Download, Info, KeyRound, ListTree, Settings, SlidersHorizontal } from "@lucide/svelte";

  let {
    onModels,
    onAuth,
    onCompact,
    onTree,
    onSettings,
    onInfo,
    onExport,
  }: {
    onModels: () => void;
    onAuth: () => void;
    onCompact: () => void;
    onTree: () => void;
    onSettings: () => void;
    onInfo: () => void;
    onExport: () => void;
  } = $props();
</script>

<div class="space-y-1.5 px-3 py-3">
  {@render MenuItem("model", onModels, "model")}
  {@render MenuItem("providers", onAuth, "auth")}

  <div class="label px-1 pt-2">context</div>
  {@render MenuItem("compact context", onCompact, "compact")}
  {@render MenuItem("conversation tree", onTree, "tree")}

  <div class="label px-1 pt-2">session</div>
  {@render MenuItem("settings", onSettings, "settings")}
  {@render MenuItem("export to HTML", onExport, "export")}
  {@render MenuItem("info", onInfo, "info")}
</div>

{#snippet MenuItem(title: string, onClick: () => void, icon: "model" | "auth" | "compact" | "tree" | "settings" | "export" | "info")}
  <button type="button" onclick={onClick} class="hairline-b flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5 text-left active:bg-[color:var(--color-surface-2)]">
    <span class="text-[color:var(--color-fg-muted)]">
      {#if icon === "model"}<SlidersHorizontal class="size-3.5" />{:else if icon === "auth"}<KeyRound class="size-3.5" />{:else if icon === "compact"}<Archive class="size-3.5" />{:else if icon === "tree"}<ListTree class="size-3.5" />{:else if icon === "settings"}<Settings class="size-3.5" />{:else if icon === "export"}<Download class="size-3.5" />{:else}<Info class="size-3.5" />{/if}
    </span>
    <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium">{title}</span>
  </button>
{/snippet}
