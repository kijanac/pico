export function pdfFileUrl(path: string, download = false): string {
  const params = new URLSearchParams({ path });
  if (download) params.set("download", "1");
  return `/fs/pdf?${params}`;
}
