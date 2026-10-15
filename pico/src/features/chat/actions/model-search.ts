import type { SessionControls } from "@pico/protocol";

export type ModelControl = Extract<SessionControls["controls"][number], { kind: "select" }>;
export type ModelOption = ModelControl["options"][number];

const normalize = (text: string): string => text.toLowerCase().replace(/[._/-]/g, "");

export function filterModelOptions(options: readonly ModelOption[], query: string): readonly ModelOption[] {
  const terms = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) => {
    const text = normalize(`${option.label} ${option.value} ${option.description ?? ""}`);
    return terms.every((term) => text.includes(term));
  });
}
