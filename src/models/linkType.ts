// 링크 유형 모델 — Flutter link_type.dart / link_input_mode.dart 이식본

export type LinkInputMode = 'username' | 'fullUrl';

export interface LinkType {
  id: string;
  label: string;
  inputMode: LinkInputMode;
  /** 프리셋 전용 — 저장 URL 패턴 (HANDOFF §5.2). `{handle}` 자리에 계정명이 들어간다. */
  urlPattern?: string;
  /** 프리셋 전용 — 전체 URL을 붙여넣었을 때 이 서비스로 인정하는 도메인 (www./m./mobile. 접두는 무시) */
  hosts?: string[];
  /** 프리셋 전용 — 계정명 길이 제한. YouTube만 있다 (§5.2) */
  handleLength?: { min: number; max: number };
  placeholder: string;
  description: string;
  iconName: string;
  /** 공식 패키지가 확인된 Android 앱만 지원. 기본값은 항상 꺼짐. */
  androidPackage?: string;
}

export const LINK_TYPES: LinkType[] = [
  {
    id: 'instagram',
    androidPackage: 'com.instagram.android',
    label: 'Instagram',
    inputMode: 'username',
    urlPattern: 'https://www.instagram.com/{handle}/',
    hosts: ['instagram.com'],
    placeholder: '@romrom_official',
    description: 'instagram.com/계정명',
    iconName: 'instagram',
  },
  {
    id: 'x',
    androidPackage: 'com.twitter.android',
    label: 'X',
    inputMode: 'username',
    urlPattern: 'https://x.com/{handle}',
    hosts: ['x.com', 'twitter.com'],
    placeholder: '@username',
    description: 'x.com/계정명',
    iconName: 'x',
  },
  {
    id: 'youtube',
    androidPackage: 'com.google.android.youtube',
    label: 'YouTube',
    inputMode: 'username',
    urlPattern: 'https://youtube.com/@{handle}',
    hosts: ['youtube.com'],
    handleLength: { min: 3, max: 30 },
    placeholder: '@username',
    description: 'youtube.com/@핸들 (3~30자)',
    iconName: 'youtube',
  },
  {
    id: 'tiktok',
    androidPackage: 'com.zhiliaoapp.musically',
    label: 'TikTok',
    inputMode: 'username',
    urlPattern: 'https://www.tiktok.com/@{handle}',
    hosts: ['tiktok.com'],
    placeholder: '@username',
    description: 'tiktok.com/@계정명',
    iconName: 'tiktok',
  },
  {
    id: 'linkedin',
    androidPackage: 'com.linkedin.android',
    label: 'LinkedIn',
    inputMode: 'username',
    urlPattern: 'https://linkedin.com/in/{handle}',
    hosts: ['linkedin.com'],
    placeholder: 'username',
    description: 'linkedin.com/in/계정명',
    iconName: 'linkedin',
  },
  {
    id: 'github',
    androidPackage: 'com.github.android',
    label: 'GitHub',
    inputMode: 'username',
    urlPattern: 'https://github.com/{handle}',
    hosts: ['github.com'],
    placeholder: 'username',
    description: 'github.com/계정명',
    iconName: 'github',
  },
  {
    id: 'custom',
    label: '직접 입력',
    inputMode: 'fullUrl',
    placeholder: 'example.com/profile',
    description: '원하는 URL을 직접 입력합니다.',
    iconName: 'link',
  },
];

export const CUSTOM_LINK_TYPE = LINK_TYPES[LINK_TYPES.length - 1];

export function findLinkTypeById(id: string): LinkType | undefined {
  return LINK_TYPES.find((t) => t.id === id);
}

/**
 * URL 도메인으로 링크 유형을 추론한다.
 *
 * 태그를 '읽을' 때는 사용자가 유형을 고른 적이 없고 URL만 있다.
 * 그래서 도메인을 보고 어디 링크인지 알아내야 쓰기 때와 같은 아이콘을 보여줄 수 있다.
 * 아는 도메인이 없으면 undefined (호출부에서 '직접 입력'으로 처리).
 */
const HOST_PATTERNS: Array<{ id: string; hosts: string[] }> = [
  { id: 'instagram', hosts: ['instagram.com', 'instagr.am'] },
  { id: 'x', hosts: ['x.com', 'twitter.com'] },
  { id: 'youtube', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'tiktok', hosts: ['tiktok.com'] },
  { id: 'linkedin', hosts: ['linkedin.com', 'lnkd.in'] },
  { id: 'github', hosts: ['github.com', 'github.io'] },
];

export function detectLinkTypeFromUrl(url: string): LinkType | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  // www. 등 서브도메인을 벗겨가며 매칭 (m.instagram.com 같은 경우까지)
  for (const { id, hosts } of HOST_PATTERNS) {
    if (hosts.some((h) => host === h || host.endsWith('.' + h))) {
      return findLinkTypeById(id);
    }
  }
  return undefined;
}

// URL 초안 (Flutter url_draft.dart)
export interface UrlDraft {
  linkType: LinkType;
  originalInput: string;
  normalizedUrl: string;
  estimatedBytes: number;
  isValid: boolean;
  /** 태그에서 읽어 온 행. 다른 앱이 쓴 레코드는 경고 없이 불러오므로(§2.1 T3) 경고 배지 대상이 아니다. */
  fromTag?: boolean;
}
