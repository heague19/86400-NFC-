// URL 정규화 — Flutter url_normalizer.dart 이식본 (로직 동일하게 유지)
//
// HANDOFF §5.1 — 두 파이프라인이 완전히 분리돼 있다.
//   프리셋: normalizePresetInput (입력 = 계정명, 허용 문자 검증 있음)
//   기타:   normalizeFullUrl     (입력 = URL 전체, 허용 문자 검증 없음)
// 이 파일은 import 없이(타입 import 제외) 유지한다 — scripts/check-*.cjs가 그대로 불러 실행한다.

import type { LinkType } from '@/models/linkType';

const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'igsh']);

const HANDLE_CHARS_PATTERN = /^[A-Za-z0-9._-]+$/;
const INVALID_PERCENT_ENCODING_PATTERN = /%(?![0-9a-fA-F]{2})/;
const SCHEME_HTTP_PATTERN = /^https?:\/\//i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
// 도메인처럼 생긴 접두 + 비어 있지 않은 경로. `john.doe`·`hong.kim/` 같은 계정명은 URL로 보지 않는다.
const HOST_WITH_PATH_PATTERN = /^[^\s/@?#]+\.[^\s/@?#]+\/\S/;

export type LinkWarningKind = 'chars' | 'format' | 'duplicate';

/** 경고 배지 — 입력·저장을 막지 않는다 (§4.3-5 · §5.6) */
export interface LinkWarning {
  kind: LinkWarningKind;
  message: string;
}

export interface PresetInputResult {
  /** 조립된 저장 URL. 입력이 비었거나 URL을 만들 수 없으면 null */
  url: string | null;
  /** 허용 문자·형식 경고. url이 있어도 함께 나온다 */
  warnings: LinkWarning[];
  /** 다른 서비스·계정 페이지가 아닌 주소를 붙여넣었을 때 기타로 넘길 수 있는 URL */
  customSuggestion: string | null;
}

/**
 * 프리셋 입력 → 저장 URL (HANDOFF §5.1 P1~P7).
 * 공백 제거 → 전체 URL 붙여넣기 처리 → 선행 @ 제거 → 끝 / 제거 → 허용 문자 검증 → 대소문자 유지 → 패턴 조립.
 * 허용 문자는 영숫자 . _ - 이고, 길이 규칙(YouTube 3~30자)은 프리셋 정의에 있을 때만 적용한다.
 * 이 규칙들은 기타(normalizeFullUrl)에 적용하지 않는다.
 */
export function normalizePresetInput(preset: LinkType, input: string): PresetInputResult {
  const none = (customSuggestion: string | null = null): PresetInputResult =>
    ({ url: null, warnings: [], customSuggestion });
  const pattern = preset.urlPattern;
  let handle = input.trim();
  if (!pattern || handle.length === 0) return none();

  if (looksLikeUrl(handle)) {
    const uri = parseUrl(handle);
    if (!uri || !isHttpProtocol(uri)) return none();
    const extracted = handleFromUrl(preset, uri);
    // 다른 도메인이거나 계정 페이지가 아니면 이 프리셋으로 만들지 않고 기타를 권한다.
    if (extracted === null) return none(normalizeFullUrl(handle));
    handle = extracted;
  }
  handle = handle.replace(/^@+/, '').replace(/\/+$/, '');
  // 비었거나 공백이 남으면 URL이 될 수 없다. (`@ /`처럼 벗기고 나서 공백만 남는 경우 포함 —
  // isValidHttpUrl은 trim 후 검사하므로 여기서 직접 걸러야 한다.)
  if (handle.length === 0 || /\s/.test(handle)) return none();

  const warnings: LinkWarning[] = [];
  if (!HANDLE_CHARS_PATTERN.test(handle)) {
    warnings.push({ kind: 'chars', message: '허용 문자(영문·숫자·. _ -)가 아닌 글자가 있습니다.' });
  }
  const length = preset.handleLength;
  if (length && (handle.length < length.min || handle.length > length.max)) {
    warnings.push({ kind: 'format', message: `${preset.label} 계정명은 ${length.min}~${length.max}자여야 합니다.` });
  }

  // 함수 치환 — 계정명의 `$&` 같은 문자가 치환 문법으로 해석되지 않게 한다.
  const url = pattern.replace('{handle}', () => handle);
  return isValidHttpUrl(url) ? { url, warnings, customSuggestion: null } : none();
}

/** 이 프리셋의 계정 페이지 URL이면 계정명, 아니면 null. 태그에서 읽은 URL의 분류에도 쓴다. */
export function extractPresetHandle(preset: LinkType, url: string): string | null {
  const uri = looksLikeUrl(url) ? parseUrl(url) : null;
  return uri && isHttpProtocol(uri) ? handleFromUrl(preset, uri) : null;
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

/**
 * 프리셋에 없는 링크는 서비스 개념이 없으므로 도메인을 라벨로 쓴다 (notion.so, velog.io).
 * ① 읽기 목록과 ② 수정 목록이 같이 쓴다 (§4.2-4 · §4.6-4).
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '링크';
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

function looksLikeUrl(input: string): boolean {
  return URL_SCHEME_PATTERN.test(input) || HOST_WITH_PATH_PATTERN.test(input);
}

function parseUrl(input: string): URL | null {
  try {
    return new URL(URL_SCHEME_PATTERN.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
}

function isHttpProtocol(uri: URL): boolean {
  return uri.protocol === 'http:' || uri.protocol === 'https:';
}

/** 프리셋 패턴의 경로 모양(`/@{handle}`, `/in/{handle}` …)과 같을 때만 계정명을 꺼낸다. */
function handleFromUrl(preset: LinkType, uri: URL): string | null {
  const host = uri.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (!preset.urlPattern || !preset.hosts?.includes(host)) return null;

  const template = preset.urlPattern.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
  const segments = uri.pathname.split('/').filter(Boolean);
  if (segments.length !== template.length) return null;

  let handle: string | null = null;
  for (let i = 0; i < template.length; i++) {
    const at = template[i].indexOf('{handle}');
    if (at < 0) {
      if (segments[i].toLowerCase() !== template[i].toLowerCase()) return null;
    } else if (segments[i].startsWith(template[i].slice(0, at))) {
      handle = segments[i].slice(at);
    } else {
      return null;
    }
  }
  return handle;
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
