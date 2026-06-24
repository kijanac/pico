import { Camera, MediaTypeSelection, type MediaResult } from "@capacitor/camera";
import type { ImageAttachment } from "@pico/protocol";

export interface PickImagesOptions {
  limit?: number;
}

export async function pickImages(opts?: PickImagesOptions): Promise<ImageAttachment[]> {
  const limit = opts?.limit ?? 4;

  try {
    const { results } = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: limit > 1,
      ...(limit > 1 ? { limit } : {}),
    });

    const attachments: ImageAttachment[] = [];
    for (const result of results) {
      const attachment = await mediaResultToAttachment(result);
      if (attachment) attachments.push(attachment);
    }
    return attachments;
  } catch (error) {
    if (isUserCancelled(error)) return [];
    console.warn("[image-picker] pickImages failed:", error);
    throw error;
  }
}

async function mediaResultToAttachment(result: MediaResult): Promise<ImageAttachment | null> {
  const url = result.webPath ?? result.uri;
  if (!url) {
    console.warn("[image-picker] result had no webPath or uri");
    return null;
  }

  const response = await fetch(url);
  const blob = await response.blob();
  const data = await blobToBase64(blob);

  return {
    data,
    mimeType: blob.type || "image/jpeg",
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader produced non-string result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function isUserCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("cancel") || message.includes("dismiss") || message.includes("no image picked");
}
