/// Generic sessionStorage access with failure tolerance. No domain rules
/// live here: callers own validation and decide what a failed write means.
export function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/// Returns false when the write could not be persisted. Callers that
/// freeze a logical command BEFORE dispatch must treat false as a hard
/// block: dispatching without a durable identity reopens the duplicate
/// window this record exists to close.
export function writeStorage(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
