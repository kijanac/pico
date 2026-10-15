<script lang="ts">
  import { Search, X } from "@lucide/svelte";
  import { Input } from "@/shared/ui/input";
  import ActionRow from "@/shared/components/ActionRow.svelte";
  import { filterModelOptions, type ModelControl } from "./model-search";

  let { control, disabled, onChange }: {
    control: ModelControl;
    disabled: boolean;
    onChange: (value: string) => void;
  } = $props();

  const id = $props.id();
  let query = $state("");
  let input = $state<HTMLInputElement | null>(null);
  const matches = $derived(filterModelOptions(control.options, query));
  const selected = $derived(control.options.find((option) => option.value === control.value));

  function clear(): void {
    query = "";
    input?.focus({ preventScroll: true });
  }
</script>

<div>
  <div class="model-search-header sticky top-0 z-10 space-y-2 bg-[color:var(--color-bg)] pb-3">
    <label class="label block" for={`${id}-search`}>search models</label>
    <div class="relative">
      <Search aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--color-fg-faint)]" />
      <Input
        id={`${id}-search`}
        type="text"
        role="searchbox"
        data-keyboard-editor
        bind:ref={input}
        bind:value={query}
        aria-controls={`${id}-results`}
        aria-describedby={`${id}-count`}
        placeholder="name, id, or provider"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck={false}
        enterkeyhint="search"
        class="type-input h-11 pl-9 pr-11"
      />
      {#if query}
        <button type="button" class="touch-target absolute right-0 top-0 flex size-11 items-center justify-center text-[color:var(--color-fg-muted)]" aria-label="Clear model search" onclick={clear}>
          <X class="size-4" />
        </button>
      {/if}
    </div>
    <div class="type-meta flex items-baseline gap-3 text-[color:var(--color-fg-muted)]">
      <p class="min-w-0 flex-1 truncate" title={selected?.label ?? control.value}>current · {(selected?.label ?? control.value) || "none"}</p>
      <p id={`${id}-count`} class="shrink-0 tabular-nums" role="status">{matches.length} {matches.length === 1 ? "model" : "models"}</p>
    </div>
  </div>
  <div id={`${id}-results`}>
    {#if matches.length === 0}
      <p class="type-copy py-4 text-[color:var(--color-fg-muted)]">{query.trim() ? "no models match your search" : "no available models"}</p>
    {:else}
      <div class="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        {#each matches as option (option.value)}
          <ActionRow
            disabled={disabled || option.disabled || option.value === control.value}
            aria-pressed={option.value === control.value}
            onclick={() => onChange(option.value)}
            class="min-h-11 gap-3 active:bg-[color:var(--color-surface-2)]"
          >
            <span class="min-w-0 flex-1">
              <span class="type-copy block truncate text-[color:var(--color-fg)]">{option.label}</span>
              {#if option.description}<span class="type-meta mt-0.5 block truncate text-[color:var(--color-fg-muted)]">{option.description}</span>{/if}
            </span>
            {#if option.value === control.value}<span class="type-meta text-[color:var(--color-accent)]">selected</span>{/if}
          </ActionRow>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  @container model-picker (height < 12rem) {
    .model-search-header {
      position: static;
    }
  }
</style>
