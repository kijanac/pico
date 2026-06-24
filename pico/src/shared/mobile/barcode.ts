import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from "@capacitor/barcode-scanner";

/**
 * Opens the native QR scanner and returns the decoded text, or null if the scan
 * was cancelled or produced nothing. Decoding runs fully on-device (Apple Vision
 * on iOS), so scanning a pairing QR works with no internet access.
 */
export async function scanQrCode(): Promise<string | null> {
  try {
    const { ScanResult } = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: "Point at the QR code from `pico pair`",
    });
    return ScanResult.trim() || null;
  } catch (error) {
    // Backing out of the scanner surfaces as a rejection; treat any failure as
    // "no scan" so the caller can simply let the user retry.
    console.warn("[barcode] scan cancelled or failed:", error);
    return null;
  }
}
