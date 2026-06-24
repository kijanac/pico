import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

let installed = false;
let resumeTick = $state(0);
let active = $state(true);

export const appLifecycle = {
  get resumeTick() {
    return resumeTick;
  },

  get active() {
    return active;
  },

  install(): void {
    if (installed) return;
    installed = true;

    if (!Capacitor.isNativePlatform()) return;

    void App.addListener("resume", () => {
      active = true;
      resumeTick += 1;
    });

    void App.addListener("pause", () => {
      active = false;
    });

    void App.addListener("appStateChange", (state) => {
      active = state.isActive;
      if (state.isActive) resumeTick += 1;
    });
  },
};
