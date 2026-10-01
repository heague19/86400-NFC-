# NFC 링크 라이터 — 검증 보고서

**검증일 2026-08-19 · 대상 5개 항목 · 전부 확인 완료 · 문서 오류 2건 발견**
**+ 2026-09-08 추가: §2.6 AAR 디스패치 동작 (T6 옵션 검토)**

---

## 목차

- [1. 검증 개요](#1-검증-개요)
  - [1.1 검증 대상](#11-검증-대상)
  - [1.2 검증 방법과 한계](#12-검증-방법과-한계)
  - [1.3 결과 요약](#13-결과-요약)
- [2. 항목별 검증 결과](#2-항목별-검증-결과)
  - [2.1 라이브러리 용량 조회 API](#21-라이브러리-용량-조회-api--확인)
  - [2.2 다중 레코드 중 첫 레코드 열림](#22-다중-레코드-중-첫-레코드-열림--확인-조건부)
  - [2.3 iOS Core NFC 엔타이틀먼트](#23-ios-core-nfc-엔타이틀먼트--확인)
  - [2.4 lock bit 비가역성](#24-lock-bit-비가역성--확인)
  - [2.5 프리셋 6종 URL 패턴](#25-프리셋-6종-url-패턴--확인-2건-조정)
  - [2.6 AAR 디스패치 동작](#26-aar-디스패치-동작--확인-2026-09-08-추가)
- [3. 문서 수정 사항](#3-문서-수정-사항)
  - [3.1 오류 정정 2건](#31-오류-정정-2건)
  - [3.2 명세 단순화 1건](#32-명세-단순화-1건)
  - [3.3 표기 조정 2건](#33-표기-조정-2건)
- [4. 영향받은 결정](#4-영향받은-결정)
- [5. 남은 확인 항목](#5-남은-확인-항목)
- [6. 출처](#6-출처)

---

## 1. 검증 개요

### 1.1 검증 대상

`DECISIONS.md`의 「미검증 사항」에 있던 5개 항목. 전부 모델 지식 기반으로만 작성되어
외부 확인이 한 번도 이루어지지 않은 상태였습니다.

| # | 항목 | 틀렸다면 무너지는 결정 |
|---|---|---|
| 1 | 라이브러리 용량 조회 노출 여부 | P3 · U1b · U4 · U1e |
| 2 | 다중 레코드 중 첫 레코드 열림 | T1 · T2 · T2a · T2b |
| 3 | iOS Core NFC 엔타이틀먼트 | P1 (iOS 지원) |
| 4 | lock bit 비가역성 | U5 |
| 5 | 프리셋 6종 URL 패턴 | F1a · F2 자동완성 |

### 1.2 검증 방법과 한계

- **방법** — 라이브러리 타입 정의 원본, 플랫폼 공식 문서, 칩 데이터시트 조회
- **한계** — **실물 태그·실기기 테스트는 하지 않았습니다.** 문서상 확인까지입니다.
  실측이 필요한 항목은 [5장](#5-남은-확인-항목)에 별도로 정리했습니다.

### 1.3 결과 요약

| # | 항목 | 결과 |
|---|---|---|
| 1 | 라이브러리 용량 조회 | ✅ 확인 — **명세보다 단순해짐** |
| 2 | 첫 레코드 열림 | ⚠️ **조건부 확인** — iOS는 배너 경유 |
| 3 | iOS 엔타이틀먼트 | ✅ 확인 |
| 4 | lock bit 비가역성 | ✅ 확인 |
| 5 | 프리셋 URL 패턴 | ✅ 확인 — 2건 표기 조정 |

**핵심:** 5개 중 4개는 문서대로였고, **2번에서 플랫폼 차이를 놓친 것**이 드러났습니다.
추가로 1번에서 상태값을 하나 빠뜨린 것을 발견했습니다.

---

## 2. 항목별 검증 결과

### 2.1 라이브러리 용량 조회 API — ✅ 확인

#### 2.1.1 확인된 API 시그니처

```typescript
interface NdefHandler {
  writeNdefMessage: (bytes: number[], options?: { reconnectAfterWrite: boolean }) => Promise<void>;
  getNdefMessage: () => Promise<TagEvent | null>;
  makeReadOnly: () => Promise<void>;
  getNdefStatus: () => Promise<{ status: NdefStatus; capacity: number }>;
  getCachedNdefMessageAndroid: () => Promise<TagEvent | null>;
}

enum NdefStatus {
  NotSupported = 1,   // NDEF 미포맷 태그
  ReadWrite    = 2,
  ReadOnly     = 3,
}
```

Android 태그 객체에는 `TagEvent.maxSize?: number`가 별도로 존재합니다.

#### 2.1.2 플랫폼 분기 불필요

`getNdefStatus()`는 `NdefHandler` 인터페이스에 **크로스플랫폼으로 선언**되어 있습니다.
같은 인터페이스의 `getCachedNdefMessageAndroid`가 이름으로 Android 전용임을 명시한 것과 대비됩니다.

→ 문서가 지시하던 `Ndef.getMaxSize()` / `queryNDEFStatus()` **플랫폼별 호출이 불필요**합니다.

#### 2.1.3 발견 — 상태값이 3가지

문서는 read-only / read-write **2가지**만 가정했으나 실제로는 `NotSupported`(NDEF 미포맷)가 있습니다.
U1e(태그 상태 확인 페이지)와 S1이 이 상태를 처리하지 않으면 미포맷 태그에서 정의되지 않은 동작을 합니다.

---

### 2.2 다중 레코드 중 첫 레코드 열림 — ⚠️ 확인(조건부)

#### 2.2.1 공통 동작

iOS·Android 모두 **첫 번째 유효 레코드만 해석**합니다.
URL 레코드가 2개면 첫 번째만 사용자에게 제시됩니다.
→ 대표 링크를 첫 레코드로 직렬화하는 **T2b 설계가 유효합니다.**

#### 2.2.2 iOS는 자동으로 열리지 않는다 🔴

| 플랫폼 | 동작 |
|---|---|
| Android | 첫 레코드 URL을 **브라우저로 바로 열기** |
| **iOS** | **시스템 배너 표시 → 사용자가 배너를 탭해야 열림** |

- iOS 13+ 백그라운드 태그 리딩, iPhone XS 이후 기기
- 자동 URL 열기를 막는 것은 **애플의 의도된 프라이버시·보안 설계**이며 우회 불가

#### 2.2.3 영향 범위

- **대표 링크 개념은 안전합니다** — 배너에 뜨는 것도 첫 레코드입니다
- **제품 문구는 수정이 필요합니다** — "태그만 대면 바로 연결됩니다"는 iOS에서 사실이 아닙니다

#### 2.2.4 추가 검증 — 앱이 설치되어 있으면? (2026-08-20)

**질문:** "앱 없는 사람"이 아니라 **"앱을 열지 않은 상태"**에서도 링크로 연결되는가?

**답: 조건부로 맞습니다. 우리 앱이 인텐트를 가로채지 않아야 합니다.**

| 상황 | 결과 |
|---|---|
| 앱 미설치 | 링크로 연결 ✅ |
| 앱 설치 + 인텐트 필터 미등록 | 링크로 연결 ✅ |
| 앱 설치 + `NDEF_DISCOVERED` 등록 | **우리 앱이 먼저 뜸** ❌ |
| 앱 포그라운드 | 앱이 읽음 (정상) |

**Android** — `ACTION_NDEF_DISCOVERED`는 최우선 인텐트입니다.
등록한 앱이 있으면 시스템이 브라우저보다 먼저 그 앱을 띄웁니다.
→ **T5 신설: 인텐트 필터를 등록하지 않는다.**

> 📌 **Android 16 변경사항.** URI 스킴이 `http://`·`https://`인 웹 링크 태그는
> `NDEF_DISCOVERED`가 아니라 **`ACTION_VIEW`를 트리거**합니다.
> 우리 태그는 전부 https URI이므로 Android 16+에서는 가로채기 자체가 불가능합니다.
> **T5는 Android 16 미만 기기를 위한 것입니다.**

**iOS** — 가로챌 방법이 없습니다. 배경 태그 리딩이 앱으로 전달되려면 **Universal Link**여야 하는데,
서버·도메인이 없으므로 만들 수 없습니다 → 항상 배너 → Safari.

**부수 확인 — 링크 대상 앱은 열립니다.**
인스타그램 앱이 설치되어 있으면 `instagram.com/...`이 인스타그램 앱으로 열립니다
(iOS Universal Links / Android App Links). 우리 앱과 무관하며 **바람직한 동작**입니다.

**부수 확인 — iOS 배경 읽기 불가 조건.**
기기가 한 번도 잠금 해제되지 않음 · Core NFC 세션 진행 중 · Apple Pay 지갑 사용 중 ·
카메라 사용 중 · 비행기 모드. 이때는 배너조차 뜨지 않습니다.

---

### 2.3 iOS Core NFC 엔타이틀먼트 — ✅ 확인

#### 2.3.1 필요 설정 3가지

1. Xcode → Signing & Capabilities → **Near Field Communication Tag Reading** 추가
2. 엔타이틀먼트 `com.apple.developer.nfc.readersession.formats` = `NDEF`
3. Info.plist에 **`NFCReaderUsageDescription`** — 빈 문자열 불가

#### 2.3.2 누락 시 동작

세션 시작 시 `NFCReaderErrorSecurityViolation`이
`readerSession:didInvalidateWithError:`로 전달됩니다.

---

### 2.4 lock bit 비가역성 — ✅ 확인

#### 2.4.1 static / dynamic lock bits

| 구분 | 위치 | 기본값 | 성질 |
|---|---|---|---|
| static lock bytes | page 2의 byte 2–3 | `00 00h` | OTP — 1→0 복구 불가 |
| dynamic lock bytes | NTAG213 page 40 / 215 page 130 / 216 page 226 | `00 00 00h` | OTP — 1→0 복구 불가 |

둘 다 one-time programmable입니다. 1로 설정할 수는 있으나 **어떤 방법으로도 0으로 되돌릴 수 없습니다.**

#### 2.4.2 U5의 근거 확립

라이브러리에 `makeReadOnly()`가 존재하므로 **구현은 가능하지만**,
되돌릴 수 없는 조작을 사용자에게 노출하지 않기로 한 U5의 판단이 데이터시트로 뒷받침됩니다.

---

### 2.5 프리셋 6종 URL 패턴 — ✅ 확인(2건 조정)

#### 2.5.1 확인 결과

| 서비스 | 문서 표기 | 검증 결과 |
|---|---|---|
| X | `x.com/{handle}` | ✅ 일치 |
| GitHub | `github.com/{handle}` | ✅ 일치 |
| LinkedIn | `linkedin.com/in/{handle}` | ✅ 일치 |
| YouTube | `youtube.com/@{handle}` | ✅ 일치 |
| Instagram | `instagram.com/{handle}` | ⚠️ 조정 필요 |
| TikTok | `tiktok.com/@{handle}` | ⚠️ 조정 필요 |

#### 2.5.2 조정 2건

| 서비스 | 실제 표준 표기 | 차이 |
|---|---|---|
| Instagram | `www.instagram.com/{handle}/` | `www.` + 끝 슬래시 |
| TikTok | `www.tiktok.com/@{handle}` | `www.` |

**기능 영향 없음.** NDEF 프리픽스 `0x02 = https://www.`가 www를 1바이트로 압축하고,
용량은 P3의 실측이므로 바이트 표의 오차가 게이지에 영향을 주지 않습니다.
다만 **자동완성이 생성할 URL 문자열은 표준 표기를 따르는 것이 안전합니다.**

#### 2.5.3 YouTube 핸들 규칙이 P5와 일치

- 길이 3~30자
- 허용 문자: 영숫자 · `.` · `_` · `-`

**F2 파이프라인 P5의 허용 문자셋과 정확히 같습니다.** 별도 예외 처리가 필요 없습니다.

---

### 2.6 AAR 디스패치 동작 — ✅ 확인 (2026-09-08 추가)

T6(AAR 옵션) 검토 과정에서 확인. 원 검증(2026-08-19, 5개 항목)과 별개로 추가된 항목입니다.

#### 2.6.1 안드로이드 공식 디스패치 규칙

출처: [NFC basics — Android Developers](https://developer.android.com/develop/connectivity/nfc/nfc)

1. 인텐트 필터로 액티비티를 먼저 찾는다. 그 액티비티가 AAR과도 일치하면 실행한다.
2. 일치하지 않거나 / 후보가 여럿이거나 / 처리할 액티비티가 없으면 → **AAR이 지정한 앱을 실행한다.**
3. **앱이 기기에 없으면 → Google Play가 열린다.**
4. 안드로이드는 NDEF 메시지 **전체**에서 AAR을 찾는다. 단, **첫 레코드로 쓰면 안 됨**
   (AAR이 유일한 레코드인 경우 제외) — 시스템이 첫 레코드로 MIME/URI를 판별하기 때문.
   → **T6b(AAR을 마지막 레코드로 직렬화)의 근거.**

3번이 이 옵션의 손해가 발생하는 지점입니다 — T6의 고지 시트(T6f)가 이 문장을 그대로 사용합니다.

#### 2.6.2 프리셋 6종 패키지명 — 확인 완료

| 프리셋 | 패키지명 | 출처 |
|---|---|---|
| Instagram | `com.instagram.android` | [Meta 개발자 문서 — Sharing to Reels](https://developers.facebook.com/docs/android/sharing-to-reels-instagram/) |
| TikTok | `com.zhiliaoapp.musically` | [TikTok 개발자 문서 — Share Kit](https://developers.tiktok.com/doc/share-kit-android-quickstart-v2) |
| YouTube | `com.google.android.youtube` | [Google 개발자 문서 — YouTube Android Live](https://developers.google.com/youtube/android/live/) |
| GitHub | `com.github.android` | Play Store 리스팅 (`id=` 파라미터, 리스팅명 "GitHub") |
| LinkedIn | `com.linkedin.android` | Play Store 리스팅 (리스팅명 "LinkedIn: Community & Network") |
| X | `com.twitter.android` | Play Store 리스팅 (리스팅명 "X") |

⚠️ **신뢰도 차이.** 위 3건은 각 서비스의 공식 개발자 문서, 아래 3건은 Play Store 리스팅
제목으로만 확인했습니다. 딥링크·SDK 문서 수준의 1차 출처는 아닙니다 — [5장](#5-남은-확인-항목)에
재확인 항목으로 남겨둡니다.

#### 2.6.3 미문서화 — Android 16

`ACTION_VIEW`로 바뀌는 http/https 태그(T5 참고)에서 AAR의 우선순위가 안드로이드 공식 문서에
명시되어 있지 않습니다. 실패해도 AAR이 무시될 뿐 링크는 열리므로 출시를 막지는 않지만,
이 옵션이 **조용히 동작을 멈출 수 있는 유일한 경로**입니다.

---

## 3. 문서 수정 사항

### 3.1 오류 정정 2건

| | 내용 | 반영 위치 |
|---|---|---|
| ① | iOS는 배너 탭이 필요 — "자동으로 열림"은 Android 기준 | T2 결정문 · 대표 링크 사슬 |
| ② | `NdefStatus`가 3가지 — `NotSupported` 누락 | U1e 상태표 · S1 |

### 3.2 명세 단순화 1건

플랫폼별 호출 2개 → **크로스플랫폼 단일 호출**로 P3 교체.

```
변경 전   Android : Ndef.getMaxSize()
          iOS     : queryNDEFStatus() → (status, capacity)

변경 후   NfcManager.ndefHandler.getNdefStatus()
            → { status: NdefStatus, capacity: number }
```

### 3.3 표기 조정 2건

Instagram · TikTok의 `www.` 및 끝 슬래시 반영 ([2.5.2](#252-조정-2건) 참조).

---

## 4. 영향받은 결정

| 결정 | 변경 전 | 변경 후 | 사유 |
|---|---|---|---|
| **T2** | 첫 번째 링크가 자동으로 열림 | 첫 링크로 연결 — Android 즉시, **iOS 배너 1탭** | 검증 2.2.2 |
| **P3** | 플랫폼별 호출 2개 | `getNdefStatus()` 단일 호출 | 검증 2.1.2 |
| **U1e** | 상태 2가지 | 상태 **3가지** + 화면 정의 | 검증 2.1.3 |
| **S1** | 읽기 전용·손상 2케이스 | `NotSupported` 추가 | 검증 2.1.3 |
| **U5** | lock bit 비가역 (추정) | 비가역 **확정** — 데이터시트 근거 | 검증 2.4 |
| **P1** | 엔타이틀먼트 필요 (개괄) | 설정 3단계 + 오류명 명시 | 검증 2.3 |
| **F1a** | Instagram · TikTok 표기 | `www.` 반영 | 검증 2.5.2 |

**유지된 결정:** T1 · T2a · T2b · F2(P5 문자셋) — 검증으로 근거가 강화되었습니다.

---

## 5. 남은 확인 항목

문서로는 확인할 수 없고 **실물·구현 단계에서만** 확인 가능한 항목입니다.

| | 항목 | 확인 시점 |
|---|---|---|
| 1 | `getNdefStatus()`가 **NTAG213 실물**에서 반환하는 capacity 실측값 | 1주차 스파이크 |
| 2 | iOS 세션 타임아웃 실제 동작 (약 60초 통설, 미확인) | 1주차 스파이크 |
| 3 | `writeNdefMessage`의 `reconnectAfterWrite` 옵션을 U3(검증 재읽기)에 쓸 수 있는지 | 쓰기 구현 시 |
| 4 | iOS Core NFC가 TNF_EXTERNAL 레코드(AAR)를 쓸 수 있는지 — T6g의 전제 | AAR 구현 시 |
| 5 | Android 16의 `ACTION_VIEW` 전환에서 AAR 우선순위 (미문서화, §2.6.3) | AAR 구현 시 |
| 6 | GitHub·LinkedIn·X 패키지명을 공식 딥링크/SDK 문서로 재확인 (§2.6.2, 현재는 Play Store 리스팅) | 해당 프리셋을 실제로 켜기 전 |

> 3번은 유용해 보입니다. U3는 "쓴 직후 다시 읽어 검증"인데
> 라이브러리가 이미 옵션으로 제공한다면 직접 구현할 필요가 없습니다.
>
> 4·5번은 실패해도 링크는 열립니다(AAR이 무시될 뿐) — 출시를 막지 않습니다.
> 6번은 전부 초기값 꺼짐이라 지금은 발생하지 않는 리스크이며, 해당 프리셋을 켜는 사용자가
> 생기기 전까지는 막지 않습니다.

---

## 6. 출처

- [react-native-nfc-manager — index.d.ts](https://github.com/revtel/react-native-nfc-manager/blob/main/index.d.ts)
- [NFC basics — Android Developers](https://developer.android.com/develop/connectivity/nfc/nfc)
- [NDEF on iOS — Dangerous Wiki](https://wiki.dangerousthings.com/en/guides/iOS-NDEF)
- [NFCNDEFReaderSession — Apple Developer](https://developer.apple.com/documentation/corenfc/nfcndefreadersession)
- [iOS Background NFC Tag Reading — GoToTags](https://learn.gototags.com/nfc/software/iphone/reading/background)
- [NTAG213/215/216 Data Sheet — NXP](https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf)
- [Understand your YouTube channel's URLs — YouTube Help](https://support.google.com/youtube/answer/6180214?hl=en)
- [Sharing to Reels (Instagram) — Meta for Developers](https://developers.facebook.com/docs/android/sharing-to-reels-instagram/) — Instagram 패키지명
- [Share Kit for Android — TikTok for Developers](https://developers.tiktok.com/doc/share-kit-android-quickstart-v2) — TikTok 패키지명
- [Initiating YouTube Live Streams on Android — Google for Developers](https://developers.google.com/youtube/android/live/) — YouTube 패키지명
