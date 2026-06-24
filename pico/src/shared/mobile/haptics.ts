import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

function fire(effect: () => Promise<void>): void {
  void effect().catch(() => {});
}

export const haptics = {
  light(): void {
    fire(() => Haptics.impact({ style: ImpactStyle.Light }));
  },

  medium(): void {
    fire(() => Haptics.impact({ style: ImpactStyle.Medium }));
  },

  heavy(): void {
    fire(() => Haptics.impact({ style: ImpactStyle.Heavy }));
  },

  success(): void {
    fire(() => Haptics.notification({ type: NotificationType.Success }));
  },

  warning(): void {
    fire(() => Haptics.notification({ type: NotificationType.Warning }));
  },

  error(): void {
    fire(() => Haptics.notification({ type: NotificationType.Error }));
  },
};
