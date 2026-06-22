<script lang="ts">
  import { Monitor, Moon, Sun } from "@lucide/svelte";
  import { themeState, type ThemeMode } from "@/shared/theme/theme.svelte";
  import { Button } from "@/shared/ui/button";

  const options: Array<{ mode: ThemeMode; label: string; icon: typeof Monitor }> = [
    { mode: "system", label: "system", icon: Monitor },
    { mode: "light", label: "light", icon: Sun },
    { mode: "dark", label: "dark", icon: Moon },
  ];

  function choose(mode: ThemeMode): void {
    void themeState.setMode(mode);
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3">
    <h2 class="type-title font-medium text-[color:var(--color-fg)]">appearance</h2>
    {#if themeState.mode === "system"}
      <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">Following your device — currently {themeState.resolved}.</p>
    {/if}
  </div>

  <div data-slot="button-group" class="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
    {#each options as option}
      {@const Icon = option.icon}
      <Button
        type="button"
        variant={themeState.mode === option.mode ? "default" : "ghost"}
        class="h-auto min-w-0 flex-col gap-1 rounded-[var(--radius-sm)] px-2 py-2"
        aria-pressed={themeState.mode === option.mode}
        onclick={() => choose(option.mode)}
      >
        <Icon class="size-3.5" />
        <span class="type-meta font-medium">{option.label}</span>
      </Button>
    {/each}
  </div>
</section>
