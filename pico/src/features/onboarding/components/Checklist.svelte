<script lang="ts">
  import { Check } from "@lucide/svelte";

  let { items }: { items: string[] } = $props();
</script>

<ul class="space-y-2">
  {#each items as item}
    <li class="type-copy flex gap-2 text-[color:var(--color-fg-muted)]">
      <Check class="mt-0.5 size-3.5 text-[color:var(--color-accent)]" />
      <span>{item}</span>
    </li>
  {/each}
</ul>
