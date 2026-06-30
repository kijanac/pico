import type { ImageContent } from "@pico/protocol";

export const MAX_IMAGE_SIDE = 1600;
export const OUTPUT_MIME = "image/jpeg";
export const OUTPUT_QUALITY = 0.84;
export const OUTPUT_QUALITY_PERCENT = Math.round(OUTPUT_QUALITY * 100);

export function cloneImageContent(images: readonly ImageContent[] | undefined): ImageContent[] | undefined {
  return images && images.length > 0
    ? images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))
    : undefined;
}

export function imageDataUrl(image: ImageContent): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export async function blobToImageContent(blob: Blob): Promise<ImageContent> {
  const normalized = await normalizeImageBlob(blob);
  return {
    type: "image",
    data: await blobToBase64(normalized),
    mimeType: normalized.type || OUTPUT_MIME,
  };
}

export async function filesToImageContent(files: readonly File[], limit: number): Promise<ImageContent[]> {
  const images: ImageContent[] = [];
  for (const file of files) {
    if (images.length >= limit) break;
    if (!file.type.startsWith("image/")) continue;
    images.push(await blobToImageContent(file));
  }
  return images;
}

async function normalizeImageBlob(blob: Blob): Promise<Blob> {
  const { image, url } = await loadImageElement(blob);
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    return await canvasToBlob(canvas, OUTPUT_MIME, OUTPUT_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImageElement(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unsupported image format. Please attach an image supported by Pi."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("image encode failed"));
    }, type, quality);
  });
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
