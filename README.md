# 86400 NFC Link Manager

NFC 태그의 링크를 읽고 편집해 오프라인에서 공유하는 React Native 앱입니다. Expo·TypeScript·React Navigation·React Context와 `react-native-nfc-manager`를 사용합니다.

링크 목록은 편집 중 메모리에만 유지하며, 앱의 로컬 저장소나 서버에 별도로 저장하지 않습니다. 기록을 저장하는 대상은 NFC 태그입니다.

## 주요 동작

- 홈에서 **링크 보기 / 링크 편집 / 태그 상태 확인**으로 진입합니다.
- Instagram·X·YouTube·TikTok·LinkedIn·GitHub 계정 링크와 직접 입력한 URL을 지원합니다.
- 대표 링크를 첫 번째 URI 레코드로 기록합니다. 링크 추가·수정·삭제·대표 지정과 비대표 링크의 드래그 정렬을 지원합니다.
- 태그가 알려준 실제 용량과 전체 NDEF 직렬화 바이트로 사용량을 계산합니다. 용량을 알 수 없거나 초과하면 저장을 막습니다.
- 저장 직후 같은 NFC 세션에서 다시 읽어 전체 메시지를 비교합니다. 실패 시 편집 내용을 유지하고 전체 재쓰기를 제공합니다.
- Android에서는 기존 태그의 비URL 기록과 AAR을 보존합니다. 기존 AAR은 켜짐으로 표시하며, 직접 끄거나 대표 앱으로 교체할 때만 변경합니다.
- 새 Android AAR 선택은 기본 꺼짐이며, 켤 때 고지 확인을 받습니다. 새로 선택·교체한 AAR은 마지막에 최대 1개를 기록합니다.

## 실행

```bash
npm ci
npm start
```

Android 실기기 개발 빌드·설치:

```bash
npm run android
```

NFC는 실기기와 네이티브 빌드가 필요하며 Expo Go로 실행할 수 없습니다. `android/`에는 직접 수정한 설정이 있으므로 재생성하지 않고 기존 프로젝트를 사용합니다. Android 빌드 준비 사항은 [STATUS.md의 준비 단계](docs/STATUS.md#준비--빌드-확인-0단계-전)를 참고하세요.

iOS 실기기 확인과 AAR 쓰기 확대는 아직 완료되지 않았습니다. 현재 iOS에서 AAR 옵션은 숨기며, 기존 비URL·AAR 기록을 보존해야 하는 쓰기는 삭제 대신 차단합니다.

## 검사

```bash
npm run typecheck
node scripts/check-nfc.cjs
node scripts/check-url-opening.cjs
node scripts/check-link-edit.cjs
node scripts/check-link-presets.cjs
node scripts/check-tag-diagnosis.cjs
```

자동 검사는 실제 서비스·상태·화면 로직을 실행하지만 네이티브 NFC 경계는 모의합니다. 비URL·기존 AAR 보존 수정의 실물 태그 테스트는 다음 테스트 묶음에서 함께 진행할 예정입니다.

## 구조와 기준 문서

| 경로 | 역할 |
|---|---|
| `App.tsx`, `src/navigation.ts` | 앱 진입점·스택 라우팅 |
| `src/screens/` | 읽기·편집·태그 진단 및 입력·쓰기 진행·완료·실패 화면 |
| `src/state/LinkWriterContext.tsx` | 편집 중 링크·보존 기록·AAR 설정·실측 용량 |
| `src/nfc/` | NFC 읽기·쓰기·진단·전체 검증과 NDEF/AAR 직렬화 |
| `src/models/`, `src/utils/` | 링크 유형·입력 정리·경고·NDEF 크기 계산 |
| `src/components/`, `src/theme/` | 공용 UI·디자인 토큰 |
| `android/` | Android 네이티브 프로젝트 |
| `scripts/` | 자동 회귀 검사 |

사양은 [HANDOFF.md](docs/HANDOFF.md), [DECISIONS.md](docs/DECISIONS.md), [VERIFICATION.md](docs/VERIFICATION.md), [SPEC-T6-AAR.md](docs/SPEC-T6-AAR.md)를 기준으로 합니다. 구현·사용자 확인 이력은 [STATUS.md](docs/STATUS.md)에서 관리하며, 보존 수정의 실기기 확인은 아직 완료 처리하지 않았습니다.

화면은 NFC 네이티브 API를 직접 호출하지 않고 `NfcService`를 사용합니다. 새 의존성·플랫폼 확대는 별도 검토하며 민감정보는 커밋하지 않습니다.
