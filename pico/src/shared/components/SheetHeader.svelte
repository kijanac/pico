<script lang="ts">
  import * as Sheet from "@/shared/ui/sheet";
  import { Button } from "@/shared/ui/button";
  import { ChevronLeft } from "@lucide/svelte";

  let { title, description, onBack, backLabel = "Back", backRef = $bindable(null) }: {
    title: string;
    description?: string;
    onBack?: () => void;
    backLabel?: string;
    backRef?: HTMLElement | null;
  } = $props();
</script>

<Sheet.Header class="hairline-b relative {description ? 'space-y-1' : 'space-y-0'} py-3 pr-12 text-left {onBack ? 'pl-14' : 'pl-3'}">
  {#if onBack}
    <Button bind:ref={backRef} type="button" variant="ghost" size="icon" onclick={onBack} aria-label={backLabel} class="absolute top-0.5 left-1 size-11 text-[color:var(--color-fg-muted)]"><ChevronLeft class="size-4" /></Button>
  {/if}
  <Sheet.Title class="type-title font-prose min-w-0 flex-1 px-1 font-medium">{title}</Sheet.Title>
  {#if description}
    <Sheet.Description class="type-copy px-1 text-[color:var(--color-fg-muted)]">{description}</Sheet.Description>
  {/if}
</Sheet.Header>
