// NFC 서비스 (쓰기/읽기) — react-native-nfc-manager 연결본
// AGENTS.md 규칙: UI는 NFC API를 직접 호출하지 않는다. 화면은 이 서비스만 사용한다.
//
// 플랫폼 차이 (AGENTS.md "Separate Android and iOS NFC logic"):
//  - iOS: 시스템이 스캔 시트를 띄운다. 안내문구는 setAlertMessage 로 전달.
//         사용자가 시트를 닫으면 세션이 취소된다.
//  - Android: 시스템 UI가 없어서 앱 화면이 곧 안내 UI다. NFC 꺼짐 상태를 앱이 직접 확인해야 한다.
//
// 실기기에서만 동작한다 (에뮬레이터에는 NFC 하드웨어가 없음).

import { Platform } from 'react-native';
import NfcManager, { Ndef, NfcErrorIOS, NfcTech, NdefStatus } from 'react-native-nfc-manager';

/** feature-spec.md "4. Error Handling Specification" 의 에러 케이스 */
export type NfcFailureReason =
  | 'unsupported'      // 기기에 NFC 하드웨어 없음
  | 'disabled'         // Android 설정에서 NFC 꺼짐
  | 'not_ndef'         // NDEF 미지원 태그
  | 'read_only'        // 읽기 전용/잠긴 태그
  | 'capacity'         // 태그 용량 초과
  | 'no_url'           // 태그에 URL 레코드 없음
  | 'cancelled'        // 사용자 취소 / 세션 종료
  | 'failed'           // 쓰기·읽기 중 오류, 태그 이동
  | 'unknown'
  | 'verify_mismatch'; // 쓰기 후 재읽기 대조 불일치 (부분 기록 가능성)

export type NfcResult =
  | { ok: true; message: string }
  | { ok: false; reason: NfcFailureReason; message: string };

export interface NfcReadResult {
  ok: boolean;
  /** 첫 번째(대표) URL — 기존 호출부 호환용 */
  url?: string;
  /** 태그에 들어 있는 모든 URL. 첫 번째가 대표(NDEF 첫 레코드) */
  urls?: string[];
  /** 태그 실제 용량(byte) — 읽어낸 경우에만 */
  capacity?: number;
  /** 쓰기 가능 여부 */
  writable?: boolean;
  reason?: NfcFailureReason;
  message: string;
}

/** feature-spec.md 의 "User Message Direction" 에 맞춘 사용자 안내 문구 */
const MESSAGES: Record<NfcFailureReason, string> = {
  unsupported: '이 기기는 NFC를 지원하지 않습니다.',
  disabled: 'NFC가 꺼져 있습니다. 설정에서 NFC를 켠 뒤 다시 시도하세요.',
  not_ndef: '이 태그는 URL 저장 형식(NDEF)을 지원하지 않습니다. 다른 태그를 사용하세요.',
  read_only: '이 태그는 읽기 전용이라 수정할 수 없습니다.',
  capacity: 'URL이 태그 용량보다 커서 저장할 수 없습니다. 더 짧은 URL을 쓰거나 용량이 큰 태그가 필요합니다.',
  no_url: '태그에서 URL을 찾지 못했습니다.',
  cancelled: 'NFC 작업이 취소되었습니다.',
  failed: '태그를 찾지 못했습니다. 휴대폰 뒷면을 태그에 다시 가까이 대주세요.',
  unknown: '알 수 없는 문제가 발생했습니다. 다시 시도해주세요.',
  // HANDOFF.md §4.9 — 쓰기 API가 성공을 반환해도 재읽기 대조가 불일치하면
  // 부분 기록 가능성이 있으므로 "실패"가 아니라 이렇게 표현한다
  verify_mismatch: '태그에 일부만 기록되었을 수 있습니다. 태그를 떼지 말고 다시 저장해주세요.',
};

function fail(reason: NfcFailureReason): { ok: false; reason: NfcFailureReason; message: string } {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** 던져진 예외를 에러 케이스로 분류 */
function classifyError(err: unknown): NfcFailureReason {
  const raw = String((err as { message?: string })?.message ?? err ?? '');

  // iOS: 사용자가 스캔 시트를 닫거나 시스템이 세션을 끝낸 경우
  if (Platform.OS === 'ios') {
    const code = NfcErrorIOS.parse(raw);
    if (code === NfcErrorIOS.errCodes.userCancel) return 'cancelled';
    if (code === NfcErrorIOS.errCodes.timeout) return 'failed';
  }

  const text = raw.toLowerCase();
  if (text.includes('cancel')) return 'cancelled';
  if (text.includes('read-only') || text.includes('read only')) return 'read_only';
  if (text.includes('not enough space') || text.includes('capacity')) return 'capacity';
  if (text.includes('ndef')) return 'not_ndef';
  // 태그가 중간에 떨어진 경우 등
  return 'failed';
}

/**
 * NFC 세션을 열고 작업을 수행한 뒤 반드시 닫는다.
 * 세션을 안 닫으면 다음 스캔이 먹히지 않으므로 finally 로 보장한다.
 */
async function withNdefSession<T>(
  alertMessage: string,
  work: () => Promise<T>,
): Promise<T> {
  await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage });
  try {
    return await work();
  } finally {
    // 취소 실패는 무시 — 원래 작업 결과/에러를 덮어쓰지 않는다
    await NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/** NFC 사용 가능 상태 확인 (하드웨어 + 설정) */
async function ensureReady(): Promise<NfcFailureReason | null> {
  const supported = await NfcManager.isSupported();
  if (!supported) return 'unsupported';

  await NfcManager.start();

  // isEnabled 는 Android 전용 개념 (iOS는 설정으로 끌 수 없음)
  if (Platform.OS === 'android') {
    const enabled = await NfcManager.isEnabled();
    if (!enabled) return 'disabled';
  }
  return null;
}

/** NDEF 레코드 배열에서 URL 추출 (URI 레코드 우선, 없으면 텍스트에서 탐색) */
function extractUrls(records: Array<{ tnf?: number; type?: unknown; payload?: unknown }>): string[] {
  const urls: string[] = [];

  const push = (u: string | null | undefined) => {
    const v = (u ?? '').trim();
    if (v && !urls.includes(v)) urls.push(v);
  };

  // URI 레코드를 순서대로 수집 — NDEF 첫 레코드가 대표 링크다
  for (const record of records) {
    try {
      if (Ndef.isType(record as never, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
        push(Ndef.uri.decodePayload(record.payload as never));
      }
    } catch {
      // 이 레코드는 건너뛰고 다음 레코드 확인
    }
  }

  // URI 레코드가 하나도 없을 때만 텍스트 레코드에서 URL을 찾는다
  if (urls.length === 0) {
    for (const record of records) {
      try {
        if (Ndef.isType(record as never, Ndef.TNF_WELL_KNOWN, Ndef.RTD_TEXT)) {
          const text = Ndef.text.decodePayload(record.payload as never);
          if (text && /^https?:\/\//i.test(text.trim())) push(text.trim());
        }
      } catch {
        // 무시
      }
    }
  }

  return urls;
}

export const NfcService = {
  /** NFC 사용 가능 여부 */
  async isSupported(): Promise<boolean> {
    try {
      return await NfcManager.isSupported();
    } catch {
      return false;
    }
  },

  /**
   * 링크 목록을 NFC 태그에 쓰기 (HANDOFF.md §2.1·§5.5).
   * urls[0]이 대표 링크이며 항상 첫 번째 NDEF 레코드로 직렬화된다.
   * 매번 전체 재작성 — 기존 레코드에 이어붙이는 부분 갱신은 하지 않는다.
   */
  async writeUrls(urls: string[]): Promise<NfcResult> {
    const notReady = await ensureReady();
    if (notReady) return fail(notReady);
    if (urls.length === 0) return fail('failed');

    try {
      return await withNdefSession('태그에 링크를 쓰는 중입니다.\n휴대폰 뒷면을 태그에 대주세요.', async () => {
        // 태그 상태 확인 — 쓰기 가능 여부와 실제 용량을 먼저 본다
        const status = await NfcManager.ndefHandler.getNdefStatus().catch(() => null);
        if (status) {
          if (status.status === NdefStatus.NotSupported) return fail('not_ndef');
          if (status.status === NdefStatus.ReadOnly) return fail('read_only');
        }

        const bytes = Ndef.encodeMessage(urls.map((u) => Ndef.uriRecord(u)));
        if (!bytes) return fail('failed');

        // 하드코딩된 144byte 대신 태그가 알려준 실제 용량으로 검사
        if (status?.capacity && bytes.length > status.capacity) {
          return fail('capacity');
        }

        await NfcManager.ndefHandler.writeNdefMessage(bytes, { reconnectAfterWrite: true });

        // HANDOFF.md §5.7 — 쓰기 API가 성공을 반환해도 부분 기록 가능성이 있으므로
        // 같은 세션에서 즉시 다시 읽어 방금 쓴 내용과 바이트 단위로 대조한다.
        // "저장됨"이라고 말하는 시점이 실제로 검증된 시점이 되도록.
        const verifyTag = await NfcManager.getTag().catch(() => null);
        const verifyRecords = verifyTag?.ndefMessage;
        const verifiedUrls = verifyRecords ? extractUrls(verifyRecords as never) : [];
        const matches =
          verifiedUrls.length === urls.length && verifiedUrls.every((u, i) => u === urls[i]);
        if (!matches) {
          return fail('verify_mismatch');
        }

        if (Platform.OS === 'ios') {
          await NfcManager.setAlertMessage('저장 완료').catch(() => {});
        }
        return { ok: true as const, message: '태그에 링크를 저장했습니다.' };
      });
    } catch (err) {
      return fail(classifyError(err));
    }
  },

  /** 단일 URL만 쓸 때의 편의 함수 (writeUrls의 얇은 래퍼) */
  async writeUrl(url: string): Promise<NfcResult> {
    return this.writeUrls([url]);
  },

  /** NFC 태그에서 URL 읽기 */
  async readUrl(): Promise<NfcReadResult> {
    const notReady = await ensureReady();
    if (notReady) return { ok: false, reason: notReady, message: MESSAGES[notReady] };

    try {
      return await withNdefSession('태그를 읽는 중입니다.\n휴대폰 뒷면을 태그에 대주세요.', async () => {
        const tag = await NfcManager.getTag();
        const status = await NfcManager.ndefHandler.getNdefStatus().catch(() => null);

        const records = tag?.ndefMessage;
        if (!records || records.length === 0) {
          return { ok: false, reason: 'no_url' as const, message: MESSAGES.no_url };
        }

        const urls = extractUrls(records as never);
        const url = urls[0];
        if (!url) {
          return { ok: false, reason: 'no_url' as const, message: MESSAGES.no_url };
        }

        if (Platform.OS === 'ios') {
          await NfcManager.setAlertMessage('읽기 완료').catch(() => {});
        }

        return {
          ok: true,
          url,
          urls,
          capacity: status?.capacity ?? tag?.maxSize,
          writable: status ? status.status === NdefStatus.ReadWrite : undefined,
          message: '태그를 읽었습니다.',
        };
      });
    } catch (err) {
      const reason = classifyError(err);
      return { ok: false, reason, message: MESSAGES[reason] };
    }
  },
};
