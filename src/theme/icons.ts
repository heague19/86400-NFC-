// 아이콘 매핑 — 디자인 시안(앱디자인_시안/) 기준
// 이모지 대신 src/assets 의 실제 아이콘 이미지를 사용한다.
//
// require()는 정적 경로만 허용하므로 여기에 한 번에 모아둔다.

import type { ImageSourcePropType } from 'react-native';

/** 링크 유형별 아이콘 (03_링크유형선택.png) */
export const LINK_TYPE_ICONS: Record<string, ImageSourcePropType> = {
  instagram: require('../assets/type_instagram.png'),
  linkedin: require('../assets/type_linkedin.png'),
  github: require('../assets/type_github.png'),
  linktree: require('../assets/type_linktree.png'),
  portfolio: require('../assets/type_portfolio.png'),
  custom: require('../assets/type_link.png'),
};

/** 기능 아이콘 (02_메뉴선택.png 등) */
export const APP_ICONS = {
  edit: require('../assets/icon_edit.png'),
  nfc: require('../assets/icon_nfc.png'),
  shield: require('../assets/icon_shield.png'),
  check: require('../assets/icon_check.png'),
} as const;

/** 로고 */
export const APP_LOGO = {
  black: require('../assets/logo_black.png'),
  white: require('../assets/logo_white.png'),
} as const;

export function linkTypeIcon(id: string): ImageSourcePropType {
  return LINK_TYPE_ICONS[id] ?? LINK_TYPE_ICONS.custom;
}
