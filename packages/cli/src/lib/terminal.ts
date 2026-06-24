import * as QRCode from "qrcode";

export async function terminalQr(text: string): Promise<string | undefined> {
  try {
    // Low ECC keeps the module count down so the half-block terminal render
    // stays sparse and scannable; a screen QR at close range needs no recovery.
    return await QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "L" });
  } catch (error) {
    console.warn(`\nWARNING: failed to render terminal QR: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
