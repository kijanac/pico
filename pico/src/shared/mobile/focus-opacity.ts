type OpacityStyle = Pick<CSSStyleDeclaration, "getPropertyValue" | "getPropertyPriority" | "setProperty" | "removeProperty">;
export type FocusViewport = { width: number; height: number; scale: number };

export function holdFocusOpacity(style: OpacityStyle): () => void {
  const value = style.getPropertyValue("opacity");
  const priority = style.getPropertyPriority("opacity");
  let restored = false;
  style.setProperty("opacity", "0", "important");
  return () => {
    if (restored) return;
    restored = true;
    if (style.getPropertyValue("opacity") !== "0" || style.getPropertyPriority("opacity") !== "important") return;
    if (value) style.setProperty("opacity", value, priority);
    else style.removeProperty("opacity");
  };
}

export function focusViewportChanged(initial: FocusViewport, current: FocusViewport): boolean {
  return current.width !== initial.width || current.scale !== initial.scale || current.height < initial.height;
}
