import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "dev.picomobile.app",
  appName: "Pico",
  webDir: "dist",
  backgroundColor: "#0a0a0a",
  ios: {
    // Let CSS safe-area env() drive app chrome placement. `always` adds a
    // native WebView inset on top of our header safe-area padding, which can
    // show up as a dead strip above sticky headers during iOS rubber-band scroll.
    contentInset: "never",
    backgroundColor: "#0a0a0a",
  },
  android: {
    backgroundColor: "#0a0a0a",
  },
  server: {
    // Set this to your LAN IP during dev for live reload on a real device.
    // url: "http://192.168.1.42:5173",
    // cleartext: true,
    androidScheme: "https",
  },
  plugins: {
    Keyboard: {
      // Keep the WebView stable and let our chat chrome move above the
      // keyboard. This avoids iOS resizing `dvh` and jumping the whole app.
      resize: KeyboardResize.None,
      style: KeyboardStyle.Dark,
    },
  },
};

export default config;
