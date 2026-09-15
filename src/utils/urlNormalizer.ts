// URL 정규화 — Flutter url_normalizer.dart 이식본 (로직 동일하게 유지)

const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'igsh']);

const INSTAGRAM_USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;
const INVALID_PERCENT_ENCODING_PATTERN = /%(?![0-9a-fA-F]{2})/;
const SCHEME_HTTP_PATTERN = /^https?:\/\//i;

export function normalizeInstagramUsername(input: string): string | null {
  let username = input.trim();
  if (username.length === 0) return null;

  username = extractInstagramUsername(username) ?? username;
  username = username.replace(/^@+/, '');

  if (!INSTAGRAM_USERNAME_PATTERN.test(username)) return null;

  const url = `https://instagram.com/${username}`;
  return isValidHttpUrl(url) ? url : null;
}

export function normalizeFullUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  if (hasUnsupportedScheme(trimmed)) return null;

  const normalized = hasAllowedScheme(trimmed) ? trimmed : `https://${trimmed}`;
  return isValidHttpUrl(normalized) ? normalized : null;
}

export function removeTrackingParams(url: string): string {
  if (!isValidHttpUrl(url) || hasInvalidPercentEncoding(url)) return url;

  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key)) parsed.searchParams.delete(key);
    }
    // 쿼리가 비면 '?'를 남기지 않음
    let out = parsed.toString();
    if (parsed.search === '' || parsed.search === '?') {
      out = out.replace(/\?$/, '');
    }
    return out;
  } catch {
    return url;
  }
}

export function isValidHttpUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.includes(' ')) return false;
  try {
    const uri = new URL(trimmed);
    const isHttp = uri.protocol === 'http:' || uri.protocol === 'https:';
    return isHttp && uri.hostname.length > 0;
  } catch {
    return false;
  }
}

function extractInstagramUsername(input: string): string | null {
  const normalizedInput = SCHEME_HTTP_PATTERN.test(input) ? input : `https://${input}`;
  let uri: URL;
  try {
    uri = new URL(normalizedInput);
  } catch {
    return null;
  }
  if (!isInstagramHost(uri.hostname)) return null;

  const segments = uri.pathname.split('/').filter((s) => s.length > 0);
  return segments.length === 1 ? segments[0] : null;
}

function isInstagramHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'instagram.com' || h === 'www.instagram.com';
}

function hasInvalidPercentEncoding(url: string): boolean {
  return INVALID_PERCENT_ENCODING_PATTERN.test(url);
}

function hasAllowedScheme(input: string): boolean {
  return SCHEME_HTTP_PATTERN.test(input);
}

function hasUnsupportedScheme(input: string): boolean {
  if (hasAllowedScheme(input)) return false;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(input);
  if (!schemeMatch) return false;

  const schemeCandidate = schemeMatch[1];
  const remainingInput = input.substring(schemeMatch[0].length);
  return !looksLikeHostPort(schemeCandidate, remainingInput);
}

function looksLikeHostPort(hostCandidate: string, remainingInput: string): boolean {
  const normalizedHost = hostCandidate.toLowerCase();
  const canBeHost = normalizedHost === 'localhost' || normalizedHost.includes('.');
  const hasPort = /^\d{1,5}($|[/?#])/.test(remainingInput);
  return canBeHost && hasPort;
}
