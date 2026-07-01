import { Clipboard } from "@capacitor/clipboard";

export async function copyText(text: string): Promise<void> {
  await Clipboard.write({ string: text });
}
