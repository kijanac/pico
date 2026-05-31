import { For, Show, type JSX } from "solid-js";

export function MenuButton(props: { title: string; description: string; onClick: () => void; icon?: JSX.Element }) {
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

export function InfoRow(props: { label: string; value: string }) {
  return (
    <div class="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
      <div class="label">{props.label}</div>
      <div class="mt-1 break-words text-[12px] text-[color:var(--color-fg)]">{props.value}</div>
    </div>
  );
}

export function ToggleRow(props: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
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

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>(props: { label: string; options: readonly SelectOption<T>[]; value: T; disabled: boolean; onChange: (value: T) => void }) {
  return (
    <div>
      <div class="label mb-1.5">{props.label}</div>
      <div class="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-1">
        <For each={[...props.options]}>
          {(option) => (
            <button
              type="button"
              disabled={props.disabled || option.disabled || option.value === props.value}
              onClick={() => props.onChange(option.value)}
              class={option.value === props.value
                ? "rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-2 text-[11px] font-medium text-[color:var(--color-bg)]"
                : "rounded-[var(--radius-sm)] px-2 py-2 text-[11px] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)] disabled:opacity-70"}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export function SelectRows<T extends string>(props: { label: string; options: readonly SelectOption<T>[]; value: T; disabled: boolean; onChange: (value: T) => void }) {
  return (
    <div>
      <div class="label mb-1.5">{props.label}</div>
      <div class="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <For each={[...props.options]}>
          {(option) => (
            <button
              type="button"
              disabled={props.disabled || option.disabled || option.value === props.value}
              onClick={() => props.onChange(option.value)}
              class="hairline-b flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[color:var(--color-surface-2)] disabled:opacity-70"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[12.5px] text-[color:var(--color-fg)]">{option.label}</span>
                <Show when={option.description}>
                  <span class="mt-0.5 block truncate text-[10.5px] text-[color:var(--color-fg-faint)]">{option.description}</span>
                </Show>
              </span>
              <Show when={option.value === props.value}>
                <span class="text-[12px] text-[color:var(--color-accent)]">selected</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
