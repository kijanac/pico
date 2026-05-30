import { Preferences } from "@capacitor/preferences";

const DEFAULT_BRIDGE_URL = "http://localhost:7777";
const ONBOARDING_DRAFT_KEY = "onboarding_draft";

export interface OnboardingDraft {
  readonly tsAuthKey: string;
  readonly tailnet: string;
  readonly bridgeHostname: string;
}

export async function getBridgeUrl(): Promise<string> {
  const { value } = await Preferences.get({ key: "bridge_url" });
  return value?.trim() || DEFAULT_BRIDGE_URL;
}

export async function setBridgeUrl(url: string): Promise<void> {
  await Preferences.set({ key: "bridge_url", value: url.trim() });
}

export async function getOnboardingDraft(): Promise<Partial<OnboardingDraft>> {
  const { value } = await Preferences.get({ key: ONBOARDING_DRAFT_KEY });
  if (!value) return {};
  try {
    return JSON.parse(value) as Partial<OnboardingDraft>;
  } catch {
    return {};
  }
}

export async function setOnboardingDraft(draft: OnboardingDraft): Promise<void> {
  await Preferences.set({ key: ONBOARDING_DRAFT_KEY, value: JSON.stringify(draft) });
}

export async function clearOnboardingDraft(): Promise<void> {
  await Preferences.remove({ key: ONBOARDING_DRAFT_KEY });
}

