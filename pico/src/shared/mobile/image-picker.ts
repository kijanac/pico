import { Camera, MediaTypeSelection, type MediaResult } from "@capacitor/camera";
import type { ImageContent } from "@pico/protocol";
import { blobToImageContent, MAX_IMAGE_SIDE, OUTPUT_QUALITY_PERCENT } from "@/shared/mobile/image-content";

export interface PickImagesOptions {
  limit?: number;
}

export async function pickImages(opts?: PickImagesOptions): Promise<ImageContent[]> {
  const limit = opts?.limit ?? 4;

  try {
    const { results } = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: limit > 1,
      ...(limit > 1 ? { limit } : {}),
      quality: OUTPUT_QUALITY_PERCENT,
      targetWidth: MAX_IMAGE_SIDE,
      targetHeight: MAX_IMAGE_SIDE,
      correctOrientation: true,
    });

    const attachments: ImageContent[] = [];
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

async function mediaResultToAttachment(result: MediaResult): Promise<ImageContent | null> {
  const url = result.webPath ?? result.uri;
  if (!url) {
    console.warn("[image-picker] result had no webPath or uri");
    return null;
  }

  const response = await fetch(url);
  return blobToImageContent(await response.blob());
}

function isUserCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("cancel") || message.includes("dismiss") || message.includes("no image picked");
}
