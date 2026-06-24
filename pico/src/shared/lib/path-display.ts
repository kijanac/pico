export function cwdDisplayName(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return cwd;

  const normalized = trimmed.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}
