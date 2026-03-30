const rawBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, '');

function runtimeFallbackBaseUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const { protocol, hostname, port } = window.location;

  // In local dev, the frontend typically runs on :3000 while FastAPI runs on :8000.
  if (port === '3000') {
    return `${protocol}//${hostname}:8000`;
  }

  return '';
}

export function apiUrl(path: string): string {
  const baseUrl = normalizedBaseUrl || runtimeFallbackBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
}
