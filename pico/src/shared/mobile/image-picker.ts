import type { ImageContent } from "@pico/protocol";
import { filesToImageContent } from "@/shared/mobile/image-content";

// Opens the system photo picker; resolves empty when the user cancels.
export function pickImages(limit: number): Promise<ImageContent[]> {
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
