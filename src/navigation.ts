// 라우팅 타입 — Flutter router.dart(AppRoutes) 이식본

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  LinkTypeSelect: undefined;
  // editIndex가 있으면 "기존 링크 수정", 없으면 "새 링크 추가"
  InstagramInput: { editIndex?: number } | undefined;
  CustomUrlInput: { editIndex?: number } | undefined;
  // HANDOFF.md §4.3 — 목록 · 대표지정 · 용량게이지 · 저장을 한 화면에서 처리
  LinkEdit: undefined;
  TagRead: undefined;
  TagInfo: { url: string; linkTypeId?: string; writable: boolean; capacity?: number };
  WriteComplete: { urls: string[]; linkTypeId?: string };
};
