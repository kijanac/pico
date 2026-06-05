<script lang="ts">
  import { navigateTo, routePaths } from "@/app/routes";
  import { Button } from "@/shared/ui/button";
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3">
    <h2 class="type-title font-medium text-[color:var(--color-fg)]">fresh box setup</h2>
    <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">
      set up a new bridge host, then let Pico wait for and claim it.
    </p>
  </div>
  <Button type="button" class="h-10 w-full" onclick={() => navigateTo(routePaths.onboarding)}>
    start setup
  </Button>
</section>
