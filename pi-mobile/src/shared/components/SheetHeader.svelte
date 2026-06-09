<script lang="ts">
  import * as Sheet from "@/shared/ui/sheet";

  let { title, description }: { title: string; description?: string } = $props();
</script>

<Sheet.Header class="hairline-b {description ? 'space-y-1' : 'space-y-0'} px-3 py-3 pr-12 text-left">
  <Sheet.Title class="type-title min-w-0 flex-1 px-1 font-medium">{title}</Sheet.Title>
  {#if description}
    <Sheet.Description class="type-copy px-1 text-[color:var(--color-fg-muted)]">{description}</Sheet.Description>
  {/if}
</Sheet.Header>
