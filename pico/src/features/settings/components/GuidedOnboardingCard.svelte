<script lang="ts">
  import { navigateTo, routePaths } from "@/app/routes";
  import { Button } from "@/shared/ui/button";
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3">
    <h2 class="type-title font-medium text-[color:var(--color-fg)]">advanced cloud host</h2>
    <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">
      generate cloud-init for a fresh Linux box when you do not want to use an existing machine.
    </p>
  </div>
  <Button type="button" class="h-10 w-full" onclick={() => navigateTo(routePaths.onboarding)}>
    create cloud host
  </Button>
</section>
