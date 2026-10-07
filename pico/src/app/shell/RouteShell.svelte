<script lang="ts">
  import { Home } from "@lucide/svelte";
  import { navigateTo, routePaths } from "@/app/routes";
  import { Button } from "@/shared/ui/button";

  // A screen's header while its code loads, so Home works from the first
  // frame; and a way out when the code can't load (offline).
  let { title, failed = false }: { title: string; failed?: boolean } = $props();
</script>

<main class="flex h-full min-h-0 flex-1 flex-col">
  <header class="border-b border-[color:var(--color-border)]">
    <div class="column flex items-center gap-3 px-3 py-[calc(env(safe-area-inset-top)+12px)] pb-3">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Sessions" title="Sessions" onclick={() => navigateTo(routePaths.sessions, "pop")}>
        <Home class="size-3.5" />
      </Button>
      <div class="type-title font-prose min-w-0 flex-1 truncate font-medium">{title}</div>
    </div>
  </header>
  {#if failed}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="type-copy text-[color:var(--color-fg-muted)]">this screen didn't load</p>
      <Button type="button" variant="outline" size="sm" onclick={() => window.location.reload()}>reload</Button>
    </div>
  {/if}
</main>
