import { getContext, setContext } from "svelte";
import { ImageMediaType, type ImageContent } from "@pico/protocol";
import { Option, Schema } from "effect";

export type ImageRequest = { image: ImageContent; label: string };
type OpenImage = (image: ImageContent, label: string) => void;
const key = Symbol("open-image");
const parseMedia = Schema.decodeUnknownOption(ImageMediaType);

export const provideImageOpener = (open: OpenImage) => setContext(key, open);
export const imageOpener = () => getContext<OpenImage | undefined>(key);

export function imagePreviewUrl(image: ImageContent): string | null {
  return Option.getOrNull(Option.map(parseMedia(image.mimeType), (media) => `data:${media};base64,${image.data}`));
}

export function imageFileUrl(path: string, download = false): string {
  const params = new URLSearchParams({ path });
  if (download) params.set("download", "1");
  return `/fs/image?${params}`;
}
