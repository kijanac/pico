<script lang="ts">
  import { Download, Info, KeyRound, ListTree, Settings, SlidersHorizontal } from "@lucide/svelte";
  import ActionRow from "@/shared/components/ActionRow.svelte";

  let {
    onModels,
    onAuth,
    onTree,
    onSettings,
    onInfo,
    onExport,
  }: {
    onModels: () => void;
    onAuth: () => void;
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
  {@render MenuItem("conversation tree", onTree, "tree")}

  <div class="label px-1 pt-2">session</div>
  {@render MenuItem("settings", onSettings, "settings")}
  {@render MenuItem("export to HTML", onExport, "export")}
  {@render MenuItem("info", onInfo, "info")}
</div>

{#snippet MenuItem(title: string, onClick: () => void, icon: "model" | "auth" | "tree" | "settings" | "export" | "info")}
  <ActionRow variant="card" onclick={onClick} class="hairline-b min-h-11 py-2.5">
    <span class="text-[color:var(--color-fg-muted)]">
      {#if icon === "model"}<SlidersHorizontal class="size-3.5" />{:else if icon === "auth"}<KeyRound class="size-3.5" />{:else if icon === "tree"}<ListTree class="size-3.5" />{:else if icon === "settings"}<Settings class="size-3.5" />{:else if icon === "export"}<Download class="size-3.5" />{:else}<Info class="size-3.5" />{/if}
    </span>
    <span class="type-copy min-w-0 flex-1 truncate font-medium">{title}</span>
  </ActionRow>
{/snippet}
