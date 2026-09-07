// Tab persistence is optional. Browser privacy settings must not disable intake.
export function readTabValue(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function writeTabValue(key: string, value: string): boolean {
  try { sessionStorage.setItem(key, value); return true; } catch { return false; }
}

export function removeTabValue(key: string): boolean {
  try { sessionStorage.removeItem(key); return true; } catch { return false; }
}
