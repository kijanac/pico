// The Vibration API; iOS Safari doesn't implement it, so these are silent there.
const vibrate = (pattern: number | number[]) => {
  navigator.vibrate?.(pattern);
};

export const haptics = {
  light: () => vibrate(10),
  medium: () => vibrate(20),
  heavy: () => vibrate(30),
  success: () => vibrate([10, 50, 10]),
};
