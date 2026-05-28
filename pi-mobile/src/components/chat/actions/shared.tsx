import { For, Show, type JSX } from "solid-js";

export function MenuButton(props: { title: string; description: string; onClick: () => void; icon?: JSX.Element }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="hairline-b flex w-full items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)]"
    >
      <Show when={props.icon}><span class="mt-0.5 text-[color:var(--color-fg-muted)]">{props.icon}</span></Show>
      <span class="min-w-0 flex-1">
        <span class="block text-[12.5px] font-medium">{props.title}</span>
        <span class="block text-[11px] text-[color:var(--color-fg-muted)]">{props.description}</span>
      </span>
    </button>
  );
}

export function InfoRow(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
      <div class="label">{props.label}</div>
      <div class="mt-1 break-words text-[12px] text-[color:var(--color-fg)]">{props.value}</div>
    </div>
  );
}

export function ToggleRow(props: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-3 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70"
    >
      <span class="text-[12.5px] font-medium">{props.label}</span>
      <span class={props.checked ? "text-[12px] text-[color:var(--color-accent)]" : "text-[12px] text-[color:var(--color-fg-faint)]"}>
        {props.checked ? "on" : "off"}
      </span>
    </button>
  );
}

export function Segmented(props: { label: string; options: readonly string[]; value: string; disabled: boolean; onChange: (value: string) => void }): JSX.Element {
  return (
    <div>
      <div class="label mb-1.5">{props.label}</div>
      <div class="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
        <For each={[...props.options]}>
          {(option) => (
            <button
              type="button"
              disabled={props.disabled || option === props.value}
              onClick={() => props.onChange(option)}
              class={option === props.value
                ? "rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 text-[11px] font-medium text-[color:var(--color-bg)]"
                : "rounded-[var(--radius-sm)] px-2 py-2 text-[11px] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}
            >
              {option}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
