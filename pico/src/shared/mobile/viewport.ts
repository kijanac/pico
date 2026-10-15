export type ViewportFrame = {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  coveredHeight: number;
};

export function sameViewportFrame(previous: ViewportFrame | null, next: ViewportFrame): boolean {
  return previous !== null
    && previous.top === next.top
    && previous.left === next.left
    && previous.width === next.width
    && previous.height === next.height
    && previous.bottom === next.bottom
    && previous.coveredHeight === next.coveredHeight;
}

type VisualBounds = Pick<VisualViewport, "offsetTop" | "offsetLeft" | "width" | "height" | "scale">;

export function projectViewport(
  layout: { width: number; height: number },
  visual?: VisualBounds | null,
): ViewportFrame | null {
  if (visual && visual.scale !== 1) return null;
  const width = visual?.width ?? layout.width;
  const height = visual?.height ?? layout.height;
  const top = visual?.offsetTop ?? 0;
  const left = visual?.offsetLeft ?? 0;
  if (![width, height, top, left, layout.height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    top,
    left,
    width,
    height,
    bottom: layout.height - height - top,
    coveredHeight: Math.max(0, layout.height - height),
  };
}
