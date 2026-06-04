<script lang="ts">
  import type { ActionErrorHandler } from "./types";
  import { getSessionSettings, patchSessionSetting } from "@/features/chat/api";
  import { haptics } from "@/shared/mobile/haptics";

  type SessionControls = Awaited<ReturnType<typeof getSessionSettings>>;
  type SessionControl = SessionControls["controls"][number];

  let {
    sessionId,
    onError,
    filterKeys,
    excludeKeys,
  }: {
    sessionId: string;
    onError: ActionErrorHandler;
    filterKeys?: readonly string[];
    excludeKeys?: readonly string[];
  } = $props();

  let saving = $state<string | null>(null);
  let settings = $state<SessionControls | null>(null);
  let loading = $state(false);

  const visibleControls = $derived(
    (settings?.controls ?? []).filter((control: SessionControl) =>
      (!filterKeys || filterKeys.includes(control.key)) && !excludeKeys?.includes(control.key),
    ),
  );

  $effect(() => {
    void loadSettings();
  });

  async function loadSettings(): Promise<void> {
    loading = true;
    try {
      settings = await getSessionSettings(sessionId);
    } catch (error) {
      onError(String(error));
    } finally {
      loading = false;
    }
  }

  async function patch(key: string, value: string | boolean): Promise<void> {
    if (saving) return;
    const previous = settings;
    saving = key;
    onError(null);
    if (previous) settings = patchLocal(previous, key, value);
    try {
      settings = await patchSessionSetting(sessionId, key, value);
      haptics.success();
    } catch (error) {
      onError(String(error));
      settings = previous;
      await loadSettings();
    } finally {
      saving = null;
    }
  }

  function patchLocal(source: SessionControls, key: string, value: string | boolean): SessionControls {
    return {
      ...source,
      controls: source.controls.map((control: SessionControl) => {
        if (control.key !== key) return control;
        if (control.kind === "select" && typeof value === "string") return { ...control, value };
        if (control.kind === "boolean" && typeof value === "boolean") return { ...control, value };
        return control;
      }),
    };
  }
</script>

<div class="flex-1 overflow-y-auto px-3 py-3">
  {#if loading}<div class="text-copy text-[color:var(--color-fg-muted)]">loading settings…</div>{/if}
  {#if settings}
    <div class="space-y-4">
      {#each visibleControls as control (control.key)}
        {@render Control(control, saving === control.key, (value) => patch(control.key, value))}
      {/each}
    </div>
  {/if}
</div>

{#snippet Control(control: SessionControl, isSaving: boolean, onChange: (value: string | boolean) => void)}
  {#if control.kind === "select"}
    {#if control.options.length <= 4 && control.options.every((option: { description?: string }) => !option.description)}
      {@render Segmented(control.label, control.options, control.value, isSaving, onChange)}
    {:else}
      {@render SelectRows(control.label, control.options, control.value, isSaving, onChange)}
    {/if}
  {:else if control.kind === "boolean"}
    {@render ToggleRow(control.label, control.value, isSaving, onChange)}
  {/if}
{/snippet}

{#snippet ToggleRow(label: string, checked: boolean, disabled: boolean, onChange: (checked: boolean) => void)}
  <button type="button" disabled={disabled} onclick={() => onChange(!checked)} class="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70">
    <span class="text-copy font-medium">{label}</span>
    <span class={checked ? "text-meta text-[color:var(--color-accent)]" : "text-meta text-[color:var(--color-fg-muted)]"}>{checked ? "on" : "off"}</span>
  </button>
{/snippet}

{#snippet Segmented(label: string, options: readonly { value: string; label: string; description?: string; disabled?: boolean }[], value: string, disabled: boolean, onChange: (value: string) => void)}
  <div>
    <div class="label mb-1.5">{label}</div>
    <div class="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
      {#each options as option (option.value)}
        <button type="button" disabled={disabled || option.disabled || option.value === value} onclick={() => onChange(option.value)} class={option.value === value ? "text-meta rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 font-medium text-[color:var(--color-bg)]" : "text-meta rounded-[var(--radius-sm)] px-2 py-2 text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}>
          {option.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet SelectRows(label: string, options: readonly { value: string; label: string; description?: string; disabled?: boolean }[], value: string, disabled: boolean, onChange: (value: string) => void)}
  <div>
    <div class="label mb-1.5">{label}</div>
    <div class="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      {#each options as option (option.value)}
        <button type="button" disabled={disabled || option.disabled || option.value === value} onclick={() => onChange(option.value)} class="hairline-b flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70">
          <span class="min-w-0 flex-1">
            <span class="text-copy block truncate text-[color:var(--color-fg)]">{option.label}</span>
            {#if option.description}<span class="text-meta mt-0.5 block truncate text-[color:var(--color-fg-muted)]">{option.description}</span>{/if}
          </span>
          {#if option.value === value}<span class="text-meta text-[color:var(--color-accent)]">selected</span>{/if}
        </button>
      {/each}
    </div>
  </div>
{/snippet}
