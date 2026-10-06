import type { ImageContent } from "@pico/protocol";
import { filesToImageContent } from "@/shared/mobile/image-content";

export interface PickImagesOptions {
  limit?: number;
}

// Opens the system photo picker; resolves empty when the user cancels.
export function pickImages(opts?: PickImagesOptions): Promise<ImageContent[]> {
  const limit = opts?.limit ?? 4;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = limit > 1;
  return new Promise((resolve, reject) => {
    input.addEventListener("change", () => {
      filesToImageContent([...(input.files ?? [])], limit).then(resolve, reject);
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
