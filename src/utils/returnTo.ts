export function safeInternalReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  const normalize = (value: string): string | null => {
    if (!value.startsWith("/")) return null;
    if (value.startsWith("//")) return null;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  };

  const direct = normalize(raw);
  if (direct) return direct;

  try {
    return normalize(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export function appendReturnParam(returnTo: string, key: string, value: string | number): string {
  const url = new URL(returnTo, window.location.origin);
  url.searchParams.set(key, String(value));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isQuickStartReturnTo(returnTo: string | null | undefined): boolean {
  if (!returnTo) return false;
  try {
    const url = new URL(returnTo, window.location.origin);
    return url.origin === window.location.origin && url.pathname === "/quick-start";
  } catch {
    return false;
  }
}

export function currentInternalPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
