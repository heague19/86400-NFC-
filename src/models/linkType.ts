// 링크 유형 모델 — Flutter link_type.dart / link_input_mode.dart 이식본

export type LinkInputMode = 'username' | 'fullUrl';

export interface LinkType {
  id: string;
  label: string;
  inputMode: LinkInputMode;
  baseUrl?: string;
  placeholder: string;
  description: string;
  iconName: string;
}

export const LINK_TYPES: LinkType[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    inputMode: 'username',
    baseUrl: 'https://instagram.com',
    placeholder: '@romrom_official',
    description: '계정명으로 Instagram 링크를 만듭니다.',
    iconName: 'instagram',
  },
  {
    id: 'x',
    label: 'X',
    inputMode: 'username',
    baseUrl: 'https://x.com',
    placeholder: '@username',
    description: '계정명으로 X 링크를 만듭니다.',
    iconName: 'link',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    inputMode: 'username',
    baseUrl: 'https://youtube.com',
    placeholder: '@username',
    description: '핸들로 YouTube 채널 링크를 만듭니다.',
    iconName: 'link',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    inputMode: 'username',
    baseUrl: 'https://tiktok.com',
    placeholder: '@username',
    description: '계정명으로 TikTok 링크를 만듭니다.',
    iconName: 'link',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    inputMode: 'fullUrl',
    placeholder: 'linkedin.com/in/username',
    description: '프로필 URL 전체를 입력합니다.',
    iconName: 'linkedin',
  },
  {
    id: 'github',
    label: 'GitHub',
    inputMode: 'fullUrl',
    placeholder: 'github.com/username',
    description: 'GitHub 프로필 또는 저장소 URL을 입력합니다.',
    iconName: 'github',
  },
  {
    id: 'linktree',
    label: 'Linktree',
    inputMode: 'fullUrl',
    placeholder: 'linktr.ee/username',
    description: 'Linktree URL을 입력합니다.',
    iconName: 'linktree',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    inputMode: 'fullUrl',
    placeholder: 'my-portfolio.com',
    description: '포트폴리오 또는 개인 웹사이트 URL을 입력합니다.',
    iconName: 'portfolio',
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
  { id: 'linktree', hosts: ['linktr.ee', 'linktree.com'] },
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
}
