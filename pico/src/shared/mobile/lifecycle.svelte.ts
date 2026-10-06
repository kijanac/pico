let installed = false;
let resumeTick = $state(0);

export const appLifecycle = {
  get resumeTick() {
    return resumeTick;
  },

  // iOS suspends a backgrounded home-screen app; becoming visible again is a resume.
  install(): void {
    if (installed) return;
    installed = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resumeTick += 1;
    });
  },
};
