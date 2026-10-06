export async function getPreference(key: string): Promise<string | null> {
  return localStorage.getItem(key);
}

export async function setPreference(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value);
}

export async function removePreference(key: string): Promise<void> {
  localStorage.removeItem(key);
}

export async function getJsonPreference<T>(key: string, fallback: T): Promise<T> {
  const value = await getPreference(key);
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonPreference(key: string, value: unknown): Promise<void> {
  await setPreference(key, JSON.stringify(value));
}
