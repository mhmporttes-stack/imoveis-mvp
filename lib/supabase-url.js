export function normalizeSupabaseUrl(rawUrl = "") {
  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) return "";

  try {
    const url = new URL(trimmedUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmedUrl;
  }
}
