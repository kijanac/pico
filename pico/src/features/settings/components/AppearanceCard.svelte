<script lang="ts">
  import { Monitor, Moon, Sun } from "@lucide/svelte";
  import { themeState, type Palette, type ThemeMode } from "@/shared/theme/theme.svelte";
  import { Button } from "@/shared/ui/button";

  const options: Array<{ mode: ThemeMode; label: string; icon: typeof Monitor }> = [
    { mode: "system", label: "system", icon: Monitor },
    { mode: "light", label: "light", icon: Sun },
    { mode: "dark", label: "dark", icon: Moon },
  ];

  const palettes: Array<{ palette: Palette; label: string }> = [
    { palette: "pico", label: "pico" },
    { palette: "brass", label: "brass" },
  ];

  function choose(mode: ThemeMode): void {
    themeState.setMode(mode);
  }
</script>

<section class="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
  <h2 class="type-title mb-3 font-medium text-[color:var(--color-fg)]">appearance</h2>

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

  <div data-slot="button-group" class="mt-2 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
    {#each palettes as option}
      <Button
        type="button"
        variant={themeState.palette === option.palette ? "default" : "ghost"}
        class="h-auto min-w-0 rounded-[var(--radius-sm)] px-2 py-2"
        aria-pressed={themeState.palette === option.palette}
        onclick={() => themeState.setPalette(option.palette)}
      >
        <span class="type-meta font-medium">{option.label}</span>
      </Button>
    {/each}
  </div>
</section>
