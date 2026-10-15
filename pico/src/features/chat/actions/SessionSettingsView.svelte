<script lang="ts">
  import type { SessionControls } from "@pico/protocol";
  import type { ActionErrorHandler } from "./types";
  import { useSessionSettings } from "./use-session-settings.svelte";
  import ActionRow from "@/shared/components/ActionRow.svelte";
  import ModelSelect from "./ModelSelect.svelte";

  type SessionControl = SessionControls["controls"][number];

  let {
    sessionId,
    onError,
    filterKeys,
    excludeKeys,
    hideLabels = false,
  }: {
    sessionId: string;
    onError: ActionErrorHandler;
    filterKeys?: readonly string[];
    excludeKeys?: readonly string[];
    hideLabels?: boolean;
  } = $props();

  const state = useSessionSettings(() => sessionId, (message) => onError(message));
  const settings = $derived(state.settings);

  const visibleControls = $derived(
    (settings?.controls ?? []).filter((control: SessionControl) =>
      (!filterKeys || filterKeys.includes(control.key)) && !excludeKeys?.includes(control.key),
    ),
  );

</script>

<div class="flex-1 overflow-y-auto px-3 py-3">
  {#if state.loading && !settings}<div class="type-copy text-[color:var(--color-fg-muted)]">loading settings…</div>{/if}
  {#if settings}
    <div class="space-y-4">
      {#each visibleControls as control (control.key)}
        {@render Control(control, state.saving !== null, (value) => state.patch(control.key, value))}
      {/each}
    </div>
  {/if}
</div>

{#snippet Control(control: SessionControl, isSaving: boolean, onChange: (value: string | boolean) => void)}
  {#if control.kind === "select"}
    {#if control.key === "model"}
      <ModelSelect {control} disabled={isSaving} onChange={(value) => onChange(value)} />
    {:else if control.options.length <= 4 && control.options.every((option: { description?: string }) => !option.description)}
      {@render Segmented(control.label, control.options, control.value, isSaving, onChange)}
    {:else}
      {@render SelectRows(control.label, control.options, control.value, isSaving, onChange)}
    {/if}
  {:else if control.kind === "boolean"}
    {@render BooleanSegmented(control.label, control.value, isSaving, onChange)}
  {/if}
{/snippet}

{#snippet BooleanSegmented(label: string, checked: boolean, disabled: boolean, onChange: (checked: boolean) => void)}
  <div>
    <div class={hideLabels ? "sr-only" : "label mb-1.5"}>{label}</div>
    <div class="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
      <button type="button" disabled={disabled || !checked} onclick={() => onChange(false)} class={!checked ? "type-meta rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 font-medium text-[color:var(--color-on-accent)]" : "type-meta rounded-[var(--radius-sm)] px-2 py-2 text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}>
        off
      </button>
      <button type="button" disabled={disabled || checked} onclick={() => onChange(true)} class={checked ? "type-meta rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 font-medium text-[color:var(--color-on-accent)]" : "type-meta rounded-[var(--radius-sm)] px-2 py-2 text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}>
        on
      </button>
    </div>
  </div>
{/snippet}

{#snippet Segmented(label: string, options: readonly { value: string; label: string; description?: string; disabled?: boolean }[], value: string, disabled: boolean, onChange: (value: string) => void)}
  <div>
    <div class={hideLabels ? "sr-only" : "label mb-1.5"}>{label}</div>
    <div class="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
      {#each options as option (option.value)}
        <button type="button" disabled={disabled || option.disabled || option.value === value} onclick={() => onChange(option.value)} class={option.value === value ? "type-meta rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 font-medium text-[color:var(--color-on-accent)]" : "type-meta rounded-[var(--radius-sm)] px-2 py-2 text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}>
          {option.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet SelectRows(label: string, options: readonly { value: string; label: string; description?: string; disabled?: boolean }[], value: string, disabled: boolean, onChange: (value: string) => void)}
  <div>
    <div class={hideLabels ? "sr-only" : "label mb-1.5"}>{label}</div>
    <div class="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      {#each options as option (option.value)}
        <ActionRow disabled={disabled || option.disabled || option.value === value} onclick={() => onChange(option.value)} class="gap-3 active:bg-[color:var(--color-surface-2)]">
          <span class="min-w-0 flex-1">
            <span class="type-copy block truncate text-[color:var(--color-fg)]">{option.label}</span>
            {#if option.description}<span class="type-meta mt-0.5 block truncate text-[color:var(--color-fg-muted)]">{option.description}</span>{/if}
          </span>
          {#if option.value === value}<span class="type-meta text-[color:var(--color-accent)]">selected</span>{/if}
        </ActionRow>
      {/each}
    </div>
  </div>
{/snippet}
