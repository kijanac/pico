import { For, Show, type JSX } from "solid-js";
import { X } from "lucide-solid";
import type { ImageAttachment } from "@pi-mobile/protocol";

/**
 * Strip of picked-image thumbnails shown above the InputBar textarea.
 * Rendered only when there's at least one image. Each thumb is tappable
 * to remove; the underlying bytes are kept as base64 in the InputBar's
 * state until send.
 */
export default function ImageTray(props: {
  images: ImageAttachment[];
  onRemove: (index: number) => void;
}): JSX.Element {
  return (
    <Show when={props.images.length > 0}>
      <div class="hairline-b flex gap-1.5 overflow-x-auto px-2 py-1.5">
        <For each={props.images}>
          {(img, i) => (
            <div class="relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border)]">
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt=""
                class="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => props.onRemove(i())}
                class="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--color-bg)]/85 text-[color:var(--color-fg)] active:opacity-80"
                aria-label="Remove image"
              >
                <X size={9} />
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
