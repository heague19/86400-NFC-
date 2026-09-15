# NFC Link Manager (React Native)

프로필 링크를 관리하고, 선택한 링크를 NFC 태그에 써서 오프라인→온라인 공유하는 앱.
= 86400 **디지털 명함 키링**의 짝이 되는 앱.

> 이 프로젝트는 기존 **Flutter 버전을 React Native(Expo + TypeScript)로 재구현**한 것입니다.
> 원본 Flutter: `../앱_nfc-link-manager/`

## 스택
- **Expo (React Native) + TypeScript** — iOS/Android 크로스플랫폼
- @react-navigation (네이티브 스택 라우팅)
- React Context (상태관리, Flutter의 ChangeNotifier 대응)
- **react-native-nfc-manager** (NFC 쓰기/읽기 — 연결 예정)
- **로컬 우선 = 서버 없음** (MVP 전략: 로컬 → 매출 후 서버)

## 실행
```bash
npm install
npm start          # Expo 개발 서버
# 실기기 필요: NFC는 에뮬레이터에서 동작하지 않음
npx expo run:android   # 또는
npx expo run:ios
```
> `react-native-nfc-manager`는 네이티브 모듈이라 **Expo Go로는 안 되고**,
> `expo prebuild` 후 개발 빌드(dev client) 또는 `expo run:*`로 실기기 설치해야 함.

## 폴더 구조
```
App.tsx                 앱 진입점(네비게이션 + Provider)
src/
  theme/tokens.ts       디자인 토큰(색·간격·타이포)
  models/linkType.ts    링크 유형·URL 초안 모델
  utils/
    urlNormalizer.ts    URL 정규화·인스타 파싱·추적파라미터 제거
    ndefSize.ts         NDEF 용량 계산(NTAG213 144B)
  state/
    LinkWriterContext.tsx  전역 상태(선택 유형·초안)
  components/           공용 UI(버튼·카드·입력필드)
  screens/             홈·유형선택·인스타입력·커스텀입력·미리보기
  nfc/nfcService.ts    NFC 쓰기/읽기 추상화 ← 실구현 자리(미구현)
```

## 진행 상태 (2026-08-17)
### ✅ 된 것
- 프로젝트 골격(Expo+TS), 네비게이션, 전역 상태
- 디자인 토큰·공용 컴포넌트
- 화면 5개: 홈 → 유형선택 → 인스타/URL 입력 → 미리보기(용량바)
- URL 정규화·NDEF 용량 로직 (**노드 실동작 테스트 10/10 통과**)

### ⬜ 아직 (MVP 핵심)
- **NFC 실제 쓰기/읽기** — `src/nfc/nfcService.ts`가 지금은 "미구현" 응답만 반환
  → react-native-nfc-manager 연결 필요 (writeNdefMessage / Ndef.uriRecord)
- 링크 로컬 저장(AsyncStorage) — 저장된 링크 목록 화면
- iOS/Android NFC 권한·플랫폼별 처리, 에러 상태 세분화

## 규칙 (원본 AGENTS.md 승계)
- UI·상태·NFC 로직 분리. 화면은 `nfcService`만 호출(네이티브 API 직접 호출 금지).
- iOS/Android NFC 로직 분리. 민감정보 커밋 금지.
- 큰 의존성 추가 전 트레이드오프 설명·승인.
