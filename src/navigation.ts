import type { NativeNdefRecord } from './nfc/aar';

// 라우팅 타입 — Flutter router.dart(AppRoutes) 이식본

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  LinkTypeSelect: undefined;
  // editIndex가 있으면 "기존 링크 수정", 없으면 "새 링크 추가"
  InstagramInput: { editIndex?: number } | undefined;
  // initialText가 있으면 입력칸을 그 값으로 채운다 ("기타로 추가" 제안에서 넘어온 붙여넣기 원문)
  CustomUrlInput: { editIndex?: number; initialText?: string } | undefined;
  // HANDOFF.md §4.3 — 목록 · 대표지정 · 용량게이지 · 저장을 한 화면에서 처리
  // 읽은 결과를 받으면 재읽기 없이 편집한다. 없으면 진입 후 먼저 태그를 읽는다.
  LinkEdit: { urls: string[]; preservedRecords?: NativeNdefRecord[]; capacity?: number; writable?: boolean } | undefined;
  TagRead: undefined;
  // HANDOFF.md §4.10 — 진단 전용. 파라미터 없이 독립 진입해 스스로 태그를 한 번 읽는다.
  TagInfo: undefined;
  WriteComplete: { urls: string[]; usedBytes: number; androidPackage?: string };
};
