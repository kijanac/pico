<script lang="ts">
  import { Monitor, Moon, Sun } from "@lucide/svelte";
  import { themeState, type ThemeMode } from "@/shared/theme/theme.svelte";
  import { Button } from "@/shared/ui/button";

  const options: Array<{ mode: ThemeMode; label: string; description: string; icon: typeof Monitor }> = [
    { mode: "system", label: "system", description: "follow device", icon: Monitor },
    { mode: "light", label: "light", description: "cream + terracotta", icon: Sun },
    { mode: "dark", label: "dark", description: "terminal dark", icon: Moon },
  ];

  function choose(mode: ThemeMode): void {
    void themeState.setMode(mode);
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <div class="mb-3">
    <h2 class="type-title font-medium text-[color:var(--color-fg)]">appearance</h2>
    <p class="type-copy mt-1 text-[color:var(--color-fg-muted)]">
      Light mode uses Pico’s app-icon palette. Current: {themeState.resolved}.
    </p>
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
        <span class={`type-label truncate ${themeState.mode === option.mode ? "opacity-80" : "text-[color:var(--color-fg-faint)]"}`}>{option.description}</span>
      </Button>
    {/each}
  </div>
</section>
