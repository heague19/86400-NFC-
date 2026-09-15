// 디자인 토큰 — 피그마 시안(2026-08) 기준 흑백 팔레트
// 시안 CSS: 배경 #FFFFFF / 텍스트·테두리 #000000 / 보조텍스트 #5F6368
//
// 2026-08-25 디자인 피드백 반영:
// - 타입 스케일 정리 (화면별 하드코딩 20/32/16/13 → 토큰으로 통일)
// - 불투명도 토큰 신설 (기존엔 색상값으로만 위계 표현)
// - 간격 토큰 확장 (하드코딩 <View height={N}> 대체)

export const AppColors = {
  primary: '#000000',
  primaryPressed: '#2A2A2A',
  background: '#FFFFFF',
  backgroundSubtle: '#F4F4F4',
  cardBackground: '#FFFFFF',
  textPrimary: '#000000',
  textSecondary: '#5F6368',
  textTertiary: '#797979',
  border: '#000000',
  borderStrong: '#000000',
  // 링 배지용 (시안 Ellipse 색상)
  ringOuter: '#E5E5E5',
  ringInner: '#606060',
  success: '#12B76A',
  successBackground: '#F4F4F4',
  error: '#D92D20',
  errorBackground: '#FDF2F2',
  link: '#2A2A2A',
  warning: '#B54708',
  warningBackground: '#F8F4EC',
  shadow: 'rgba(0, 0, 0, 0.08)',
} as const;

/**
 * 불투명도 위계 — 같은 검정을 쓰되 중요도로 낮춘다.
 * 색상(#5F6368 등)을 새로 만드는 대신 이 값을 쓰면 위계가 일관된다.
 */
export const AppOpacity = {
  /** 본문·제목 등 1차 정보 */
  full: 1,
  /** 보조 설명 — 읽히되 앞서지 않는 정도 */
  secondary: 0.62,
  /** 캡션·부가 정보 */
  tertiary: 0.45,
  /** 장식 요소(연결 고리 등) */
  decorative: 0.3,
  /** 눌림 상태 */
  pressed: 0.45,
  /** 비활성 */
  disabled: 0.35,
} as const;

export const AppSpacing = {
  screenPadding: 24,
  cardPadding: 18,
  /** 4 배수 스케일 — 하드코딩 spacer 대체용 */
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
  itemGap: 12,
  sectionGap: 28,
  bottomSafePadding: 20,
} as const;

export const AppRadius = {
  card: 12,
  input: 12,
  button: 12,
  badge: 999,
} as const;

export const AppSizes = {
  buttonHeight: 65,   // 시안 Frame 784
  cardHeight: 107,    // 시안 Frame 779~783
  cardIcon: 65,       // 시안 아이콘 65x65
} as const;

// 공통 텍스트 스타일 (Flutter TextTheme 대응)
// 스케일: 28 / 22 / 18 / 16 / 15 / 13 / 11 — 인접 단계가 최소 2px 차이 나도록
export const AppText = {
  /** 화면 대표 제목 (구 32px 하드코딩 대체) */
  displaySmall: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    color: AppColors.textPrimary,
  },
  headlineLarge: {
    fontSize: 22,
    fontWeight: '700' as const,
    lineHeight: 28,
    color: AppColors.textPrimary,
  },
  titleLarge: {
    fontSize: 17,
    fontWeight: '700' as const,
    lineHeight: 23,
    color: AppColors.textPrimary,
  },
  /** 카드 제목 등 (구 20px 하드코딩 대체) */
  titleMedium: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 21,
    color: AppColors.textPrimary,
  },
  bodyLarge: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
    color: AppColors.textPrimary,
  },
  bodyMedium: {
    fontSize: 13.5,
    fontWeight: '400' as const,
    lineHeight: 20,
    color: AppColors.textSecondary,
  },
  /** 버튼 라벨 — 65px 버튼 대비 20px는 과대해서 17로 */
  labelLarge: {
    fontSize: 17,
    fontWeight: '700' as const,
    lineHeight: 22,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 14,
  },
} as const;

// 시안은 그림자 없이 1px 검은 테두리만 사용
export const cardShadow = {
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
} as const;
