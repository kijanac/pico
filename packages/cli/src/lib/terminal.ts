import * as QRCode from "qrcode";

export async function terminalQr(text: string): Promise<string | undefined> {
  try {
    return await QRCode.toString(text, { type: "terminal", small: true });
  } catch (error) {
    console.warn(`\nWARNING: failed to render terminal QR: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
