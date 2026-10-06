let installed = false;
let keyboardHeight = $state(0);

// Safari keeps the layout viewport when the keyboard opens and shrinks only the
// visual viewport; the difference is how much of the page the keyboard covers.
function updateKeyboardHeight(): void {
  const viewport = window.visualViewport;
  keyboardHeight = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    : 0;
}

export const keyboardState = {
  get height() {
    return keyboardHeight;
  },

  install(): void {
    if (installed) return;
    installed = true;
    window.visualViewport?.addEventListener("resize", updateKeyboardHeight);
    window.visualViewport?.addEventListener("scroll", updateKeyboardHeight);
    window.addEventListener("resize", updateKeyboardHeight);
    updateKeyboardHeight();
  },
};
