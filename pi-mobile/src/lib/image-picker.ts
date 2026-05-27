import { Capacitor } from "@capacitor/core";
import {
  Camera,
  MediaTypeSelection,
  type MediaResult,
} from "@capacitor/camera";
import type { ImageAttachment } from "@pi-mobile/protocol";

/**
 * Image picker, wrapping @capacitor/camera v8.
 *
 * v8 deprecated `getPhoto` / `pickImages` in favour of the modern
 * `takePhoto` / `chooseFromGallery` calls, which always return file
 * URIs (or a webPath on web). Crucially, the Base64 result type is
 * gone — we have to fetch the URI ourselves and base64-encode.
 *
 * Permissions and platform notes:
 *   - On web: `chooseFromGallery` shows the browser's file picker, no
 *     permission dialog needed. `takePhoto` may not work depending on
 *     the browser's getUserMedia support; we don't expose camera on web.
 *   - On native: the plugin requests CAMERA / PHOTO_LIBRARY permissions
 *     on first call. We don't pre-flight checkPermissions because the
 *     plugin's UI already handles deny/retry gracefully.
 */

export interface PickOptions {
  /** Max images per pick (gallery only — camera is always 1). Default 4. */
  limit?: number;
  /** JPEG quality 0–100 (compresses on iOS/Android). Default 85. */
  quality?: number;
}

/** Open the camera and capture a single photo as an ImageAttachment. */
export async function takePhoto(
  opts?: PickOptions,
): Promise<ImageAttachment | null> {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback: chooseFromGallery routes through the file picker,
    // which is the only sensible "take a photo" on desktop.
    const many = await chooseFromGallery({ ...opts, limit: 1 });
    return many[0] ?? null;
  }
  try {
    const result = await Camera.takePhoto({
      quality: opts?.quality ?? 85,
      saveToGallery: false,
    });
    return await mediaResultToAttachment(result);
  } catch (e) {
    if (isUserCancelled(e)) return null;
    console.warn("[image-picker] takePhoto failed:", e);
    throw e;
  }
}

/** Open the gallery and let the user pick up to `limit` images. */
export async function chooseFromGallery(
  opts?: PickOptions,
): Promise<ImageAttachment[]> {
  const limit = opts?.limit ?? 4;
  try {
    const { results } = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: limit > 1,
      // `limit` only honoured when multi-select is on. 0 = unlimited
      // per the plugin docs; we'd rather cap explicitly, so pass `limit`
      // when it's > 1, else omit (the single-select branch ignores it).
      ...(limit > 1 ? { limit } : {}),
    });
    const attachments: ImageAttachment[] = [];
    for (const r of results) {
      const a = await mediaResultToAttachment(r);
      if (a) attachments.push(a);
    }
    return attachments;
  } catch (e) {
    if (isUserCancelled(e)) return [];
    console.warn("[image-picker] chooseFromGallery failed:", e);
    throw e;
  }
}

/* ── internals ─────────────────────────────────────────────────────── */

/**
 * Fetch a MediaResult's URI/webPath and base64-encode the bytes.
 *
 * On native, Capacitor's WebView serves file:// and capacitor:// URLs
 * to fetch() so we don't need @capacitor/filesystem for this. On web,
 * `webPath` is a blob: URL the browser created for us.
 */
async function mediaResultToAttachment(
  r: MediaResult,
): Promise<ImageAttachment | null> {
  const url = r.webPath ?? r.uri;
  if (!url) {
    console.warn("[image-picker] no webPath or uri on result");
    return null;
  }
  const res = await fetch(url);
  const blob = await res.blob();
  const data = await blobToBase64(blob);
  return {
    data,
    // Capacitor's MediaResult does not carry a mimeType field; fall
    // back to the blob's type (browser-derived) or assume jpeg.
    mimeType: blob.type || "image/jpeg",
  };
}

/** Read a Blob as a base64 string (no data: prefix). */
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
      // result is "data:<mime>;base64,<payload>" — strip the prefix.
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Capacitor surfaces user cancel as an Error with a recognizable
 * message. Different plugin versions phrase it differently, so check
 * a few known variants.
 */
function isUserCancelled(e: unknown): boolean {
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return (
    msg.includes("cancel") ||
    msg.includes("dismiss") ||
    msg.includes("no image picked")
  );
}
