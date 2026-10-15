import type { SessionControls } from "@pico/protocol";
import { patchSessionSetting } from "@/features/chat/api";
import { activeSessionState } from "@/features/chat/model/active-session.state.svelte";
import { hostIssueSummary } from "@/shared/lib/host-issues";
import type { ActionErrorHandler } from "./types";

export function useSessionSettings(sessionId: () => string, onError: ActionErrorHandler) {
  let saving = $state<string | null>(null);
  let loading = $state(false);
  let generation = 0;
  const settings = $derived(activeSessionState.controls.value);

  async function load(id: string, owner: number): Promise<void> {
    loading = true;
    try {
      await activeSessionState.controls.load(id);
    } catch (error) {
      if (owner === generation) onError(hostIssueSummary(error));
    } finally {
      if (owner === generation) loading = false;
    }
  }

  $effect(() => {
    const id = sessionId();
    const owner = ++generation;
    saving = null;
    void load(id, owner);
    return () => { generation += 1; };
  });

  async function patch(key: string, value: string | boolean): Promise<void> {
    if (saving || !settings) return;
    const id = sessionId();
    const owner = generation;
    const optimistic = {
      ...settings,
      controls: settings.controls.map((control) => {
        if (control.key !== key) return control;
        if (control.kind === "select" && typeof value === "string") return { ...control, value };
        if (control.kind === "boolean" && typeof value === "boolean") return { ...control, value };
        return control;
      }),
    } satisfies SessionControls;
    saving = key;
    onError(null);
    try {
      await activeSessionState.controls.update(id, optimistic, patchSessionSetting(id, key, value));
    } catch (error) {
      if (owner === generation) {
        onError(hostIssueSummary(error));
        await load(id, owner);
      }
    } finally {
      if (owner === generation) saving = null;
    }
  }

  return {
    get settings() { return settings; },
    get saving() { return saving; },
    get loading() { return loading; },
    reload: () => load(sessionId(), generation),
    patch,
  };
}
