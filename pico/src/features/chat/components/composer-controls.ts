import type { SessionControls } from "@pico/protocol";

function selectControl(settings: SessionControls | null, key: string) {
  const control = settings?.controls.find((control) => control.key === key);
  return control?.kind === "select" ? control : null;
}

export function composerControls(settings: SessionControls | null): { model: string; thinking: string | null } {
  const model = selectControl(settings, "model");
  const thinking = selectControl(settings, "thinkingLevel");
  const canChangeThinking = thinking?.options.some((option) => !option.disabled && option.value !== thinking.value);
  return {
    model: (model?.options.find((option) => option.value === model.value)?.label ?? model?.value) || "model",
    thinking: thinking && canChangeThinking
      ? thinking.options.find((option) => option.value === thinking.value)?.label ?? thinking.value
      : null,
  };
}
