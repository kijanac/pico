/** Persistent app settings backed by Capacitor Preferences. */
import { Preferences } from "@capacitor/preferences";

const DEFAULT_BRIDGE_URL = "http://localhost:7777";

export async function getBridgeUrl(): Promise<string> {
  const { value } = await Preferences.get({ key: "bridge_url" });
  return value?.trim() || DEFAULT_BRIDGE_URL;
}

export async function setBridgeUrl(url: string): Promise<void> {
  await Preferences.set({ key: "bridge_url", value: url.trim() });
}

