import { For, Match, Show, Switch, createResource, createSignal } from "solid-js";
import type { SessionControl } from "@pi-mobile/protocol";
import { getSessionSettings, patchSessionSetting } from "@/lib/api";
import { getBridgeUrl } from "@/lib/settings";
import { haptic } from "@/lib/haptics";
import { Segmented, SelectRows, ToggleRow } from "./shared";
import type { ActionErrorHandler } from "./types";

export default function SessionSettingsView(props: { sessionId: string; onError: ActionErrorHandler; filterKeys?: readonly string[] }) {
  const [saving, setSaving] = createSignal<string | null>(null);
  const [settings, { refetch, mutate }] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionSettings(baseUrl, props.sessionId);
  });

  async function patch(key: string, value: string | boolean) {
    if (saving()) return;
    const prev = settings();
    setSaving(key);
    props.onError(null);
    if (prev) {
      mutate({
        ...prev,
        controls: prev.controls.map((control) => {
          if (control.key !== key) return control;
          if (control.kind === "select" && typeof value === "string") return { ...control, value };
          if (control.kind === "boolean" && typeof value === "boolean") return { ...control, value };
          return control;
        }),
      });
    }
    try {
      const baseUrl = await getBridgeUrl();
      const next = await patchSessionSetting(baseUrl, props.sessionId, key, value);
      mutate(next);
      haptic.success();
    } catch (e) {
      props.onError(String(e));
      if (prev) mutate(prev);
      await refetch();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto px-3 py-3">
      <Show when={settings.loading}><div class="text-[12px] text-[color:var(--color-fg-faint)]">loading settings…</div></Show>
      <Show when={settings()}>
        {(s) => (
          <div class="space-y-4">
            <For each={s().controls.filter((control) => !props.filterKeys || props.filterKeys.includes(control.key))}>{(control) => <Control control={control} saving={saving() === control.key} onChange={(value) => patch(control.key, value)} />}</For>
          </div>
        )}
      </Show>
    </div>
  );
}

function Control(props: { control: SessionControl; saving: boolean; onChange: (value: string | boolean) => void }) {
  return (
    <Switch>
      <Match when={props.control.kind === "select" && props.control}>
        {(control) => control().options.length <= 4 && control().options.every((option) => !option.description)
          ? <Segmented label={control().label} options={control().options} value={control().value} disabled={props.saving} onChange={props.onChange} />
          : <SelectRows label={control().label} options={control().options} value={control().value} disabled={props.saving} onChange={props.onChange} />}
      </Match>
      <Match when={props.control.kind === "boolean" && props.control}>
        {(control) => <ToggleRow label={control().label} checked={control().value} disabled={props.saving} onChange={props.onChange} />}
      </Match>
    </Switch>
  );
}
