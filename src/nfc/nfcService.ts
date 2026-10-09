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
import type { NdefRecord } from 'react-native-nfc-manager';
import { isValidHttpUrl } from '../utils/urlNormalizer';
import { encodeLinkMessage, readAarRecords, type AarRecord } from './aar';

/** feature-spec.md "4. Error Handling Specification" 의 에러 케이스 */
export type NfcFailureReason =
  | 'unsupported'      // 기기에 NFC 하드웨어 없음
  | 'disabled'         // Android 설정에서 NFC 꺼짐
  | 'not_ndef'         // NDEF 미지원 태그
  | 'read_only'        // 읽기 전용/잠긴 태그
  | 'status_unknown'   // 태그 상태/용량 확인 실패
  | 'capacity'         // 태그 용량 초과
  | 'no_url'           // 태그에 URL 레코드 없음
  | 'cancelled'        // 사용자 취소 / 세션 종료
  | 'failed'           // 쓰기·읽기 중 오류, 태그 이동
  | 'unknown'
  | 'verify_mismatch'; // 쓰기 후 재읽기 대조 불일치 (부분 기록 가능성)

export type NfcWriteStage = 'waiting' | 'writing' | 'verifying';
export interface NfcWriteOptions {
  androidPackage?: string;
  signal?: AbortSignal;
  onStage?: (stage: NfcWriteStage) => void;
}

export type NfcWriteResult =
  | { ok: true; message: string; usedBytes: number; androidPackage?: string }
  | { ok: false; reason: NfcFailureReason; message: string };

export type NfcResult =
  | { ok: true; message: string }
  | { ok: false; reason: NfcFailureReason; message: string };

export interface NfcReadResult {
  ok: boolean;
  /** 첫 번째(대표) URL — 기존 호출부 호환용 */
  url?: string;
  /** 태그에 들어 있는 모든 URL. no_url의 []는 상태 조회에 성공한 빈 NDEF 태그만 뜻한다. */
  urls?: string[];
  /** 태그 실제 용량(byte) — 읽어낸 경우에만 */
  capacity?: number;
  /** 쓰기 가능 여부 */
  writable?: boolean;
  aarRecords?: AarRecord[];
  usedBytes?: number;
  reason?: NfcFailureReason;
  message: string;
}

/** NdefStatus 3상태 (HANDOFF §4.10). 상태를 조회하지 못한 경우는 상태가 아니라 status_unknown 실패다. */
export type NfcTagState = 'read_write' | 'read_only' | 'not_ndef';

/**
 * ③ 진단 결과 — 한 번의 조회에서 나온 값만 담는다. 알 수 없는 값은 undefined이며 상수로 채우지 않는다.
 * not_ndef는 용량·메시지가 없으므로 capacity/usedBytes/recordCount도 없다.
 * 메시지 필드가 없거나 배열이 아니면(무메시지와 조회 실패를 구분할 수 없음) usedBytes/recordCount도 없다.
 */
export type NfcInspectResult =
  | {
    ok: true;
    state: NfcTagState;
    /** 태그가 보고한 용량(byte) */
    capacity?: number;
    /** 읽은 전체 NDEF 메시지를 그대로 직렬화한 길이. 직렬화할 수 없으면 undefined (URL로 추정하지 않는다) */
    usedBytes?: number;
    /** 읽은 전체 메시지의 실제 레코드 수 — URL이 아닌 레코드와 TNF_EMPTY 레코드 포함. 무메시지 []만 0 */
    recordCount?: number;
    /** 그중 http(s) URL로 읽히는 링크 */
    urls: string[];
    aarRecords?: AarRecord[];
    message: string;
  }
  | { ok: false; reason: NfcFailureReason; message: string };

/** feature-spec.md 의 "User Message Direction" 에 맞춘 사용자 안내 문구 */
const MESSAGES: Record<NfcFailureReason, string> = {
  unsupported: '이 기기는 NFC를 지원하지 않습니다.',
  disabled: 'NFC가 꺼져 있습니다. 설정에서 NFC를 켠 뒤 다시 시도하세요.',
  not_ndef: '이 태그는 URL 저장 형식(NDEF)을 지원하지 않습니다. 다른 태그를 사용하세요.',
  read_only: '이 태그는 읽기 전용이라 수정할 수 없습니다.',
  status_unknown: '태그 상태를 확인할 수 없습니다. 태그를 떼었다가 다시 대고 시도해주세요.',
  capacity: 'URL이 태그 용량보다 커서 저장할 수 없습니다. 더 짧은 URL을 쓰거나 용량이 큰 태그가 필요합니다.',
  no_url: '태그에서 URL을 찾지 못했습니다.',
  cancelled: 'NFC 작업이 취소되었습니다.',
  failed: '태그를 찾지 못했습니다. 휴대폰 뒷면을 태그에 다시 가까이 대주세요.',
  unknown: '알 수 없는 문제가 발생했습니다. 다시 시도해주세요.',
  // HANDOFF.md §4.9 — 쓰기 API가 성공을 반환해도 재읽기 대조가 불일치하면
  // 부분 기록 가능성이 있으므로 "실패"가 아니라 이렇게 표현한다
  verify_mismatch: '태그에 일부만 기록되었을 수 있습니다. 편집 내용은 그대로 남아 있습니다. 전체 재쓰기를 누르고 태그를 다시 대주세요.',
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

let pendingNdefCleanup: Promise<void> | undefined;

/**
 * NFC 세션을 열고 작업을 수행한 뒤 반드시 닫는다.
 * 세션을 안 닫으면 다음 스캔이 먹히지 않으므로 finally 로 보장한다.
 */
async function withNdefSession<T>(
  alertMessage: string,
  work: (connectedTech: string | null | undefined) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  // Android 취소는 태그 이벤트 등록 해제까지 비동기로 끝난다. 다음 요청은 그 뒤에 연다.
  await pendingNdefCleanup;
  if (signal?.aborted) throw new Error('cancelled');
  let cleanup: Promise<void> | undefined;
  const cancel = () => {
    if (!cleanup) {
      // 이 요청의 취소와 finally가 같은 정리를 공유해, 늦은 결과가 다음 세션을 닫지 않는다.
      cleanup = NfcManager.cancelTechnologyRequest().catch(() => {});
      pendingNdefCleanup = cleanup;
    }
    return cleanup;
  };
  const onAbort = () => { void cancel(); };
  signal?.addEventListener('abort', onAbort);
  try {
    const connectedTech = await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage });
    if (signal?.aborted) throw new Error('cancelled');
    const result = await work(connectedTech);
    if (signal?.aborted) throw new Error('cancelled');
    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // 취소 실패는 무시 — 원래 작업 결과/에러를 덮어쓰지 않는다
    await cancel();
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

type TagStatus =
  | { kind: 'ready'; writable: boolean; capacity: number }
  | { kind: 'not_ndef' }
  | { kind: 'unknown' };

const ANDROID_NDEF_TECH = 'android.nfc.tech.Ndef';

/**
 * 태그 상태 조회 — 확인되지 않으면 'unknown'이고 호출부는 쓰지 않고 멈춘다 (판정 1).
 *
 * Android: requestTechnology가 정확히 null이면 태그는 잡혔지만 Ndef 기술로 연결되지 않은 것이다.
 * 이때 getNdefStatus는 연결 없이도 캐시된 값을 돌려줄 수 있으므로 'ready'로 믿지 않는다.
 * 태그의 techTypes에 Ndef가 없을 때만 미지원 증거이고, Ndef가 있는데 null이면 연결 실패(태그 이동 등)이므로
 * 확인 불가다. 또 Android 라이브러리는 조회 오류도 NotSupported/capacity=0으로 돌려주므로
 * (연결된 뒤라면) 그 값 자체는 미지원 증거가 아니다.
 */
async function getTagStatus(connectedTech: string | null | undefined): Promise<TagStatus> {
  if (Platform.OS === 'android' && connectedTech === null) {
    const techTypes = (await NfcManager.getTag().catch(() => null))?.techTypes;
    return Array.isArray(techTypes) && techTypes.length > 0 && !techTypes.includes(ANDROID_NDEF_TECH)
      ? { kind: 'not_ndef' }
      : { kind: 'unknown' };
  }
  const status = await NfcManager.ndefHandler.getNdefStatus().catch(() => null);
  if (status?.status === NdefStatus.NotSupported && Platform.OS === 'ios') return { kind: 'not_ndef' };
  if (status &&
      (status.status === NdefStatus.ReadWrite || status.status === NdefStatus.ReadOnly) &&
      Number.isSafeInteger(status.capacity) && status.capacity > 0) {
    return { kind: 'ready', writable: status.status === NdefStatus.ReadWrite, capacity: status.capacity };
  }
  return { kind: 'unknown' };
}

/** Native type=byte[]; Android id=hex 문자열, iOS id=byte[]. 모든 필드와 순서 유지. */
function encodeNativeRecords(records: Array<Omit<NdefRecord, 'id'> & { id?: number[] | string }>) {
  return Ndef.encodeMessage(records.map((record) => {
    const validBytes = (value: unknown): value is number[] => Array.isArray(value) &&
      value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
    if (!Number.isInteger(record.tnf) || record.tnf < 0 || record.tnf > 7 || !validBytes(record.payload) ||
        (typeof record.type !== 'string' && !validBytes(record.type)) ||
        (record.id !== undefined && typeof record.id !== 'string' && !validBytes(record.id))) {
      throw new Error('Invalid native NDEF record');
    }
    const type = typeof record.type === 'string' ? record.type : Ndef.util.bytesToString(record.type);
    // type 디코딩이 원래 바이트를 바꾸면 검증 실패로 처리한다.
    if (typeof type !== 'string' || (Array.isArray(record.type) &&
        Ndef.util.bytesToHexString(Ndef.util.stringToBytes(type)) !==
        Ndef.util.bytesToHexString(record.type))) throw new Error('Invalid NDEF type');
    const nativeId = record.id;
    if (typeof nativeId === 'string' && !/^(?:[0-9a-f]{2})*$/i.test(nativeId)) {
      throw new Error('Invalid NDEF id');
    }
    const id = typeof nativeId === 'string'
      ? (nativeId.match(/../g) ?? []).map((byte) => parseInt(byte, 16))
      : nativeId ?? [];
    return { ...record, type, id };
  }));
}

/** NDEF 레코드 배열에서 URL 추출 (URI 레코드 우선, 없으면 텍스트에서 탐색) */
function extractUrls(records: Array<{ tnf?: number; type?: unknown; payload?: unknown }>): string[] {
  const urls: string[] = [];

  const push = (u: string | null | undefined) => {
    // 검증만 하고 원문을 보존한다. 기존 태그의 중복 URL도 각각 별도 레코드다.
    if (typeof u === 'string' && isValidHttpUrl(u)) urls.push(u);
  };

  // URI 레코드를 순서대로 수집 — NDEF 첫 레코드가 대표 링크다
  for (const record of records) {
    try {
      if (Ndef.isType(record as never, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
        // ndef-lib는 잘못된 UTF-8을 null 문자열로 이어붙인다 (예: https://null).
        const payload = record.payload as number[];
        decodeURIComponent(payload.slice(1).map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
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
          if (text && /^https?:\/\//i.test(text.trim())) push(text);
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
  async writeUrls(urls: string[], options: NfcWriteOptions = {}): Promise<NfcWriteResult> {
    const { signal, onStage } = options;
    const checkCancelled = () => { if (signal?.aborted) throw new Error('cancelled'); };
    // 대기 중 외부 배열이 바뀌어도 이번에 쓸 전체 메시지는 그대로 유지한다.
    const snapshot = [...urls];
    const androidPackage = Platform.OS === 'android' ? options.androidPackage : undefined;
    try {
      checkCancelled();
      onStage?.('waiting');
      const notReady = await ensureReady();
      checkCancelled();
      if (notReady) return fail(notReady);
      if (snapshot.length === 0) return fail('failed');
      return await withNdefSession('태그에 링크를 쓰는 중입니다.\n휴대폰 뒷면을 태그에 대주세요.', async (connectedTech) => {
        // 태그 상태 확인 — 쓰기 가능 여부와 실제 용량을 먼저 본다
        const status = await getTagStatus(connectedTech);
        if (status.kind === 'unknown') return fail('status_unknown');
        if (status.kind === 'not_ndef') return fail('not_ndef');
        if (!status.writable) return fail('read_only');

        const bytes = encodeLinkMessage(snapshot, androidPackage);
        if (!bytes) return fail('failed');

        // 하드코딩된 144byte 대신 태그가 알려준 실제 용량으로 검사
        if (bytes.length > status.capacity) {
          return fail('capacity');
        }

        checkCancelled();
        onStage?.('writing');
        checkCancelled();
        await NfcManager.ndefHandler.writeNdefMessage(bytes, { reconnectAfterWrite: true });
        checkCancelled();
        onStage?.('verifying');
        checkCancelled();

        // HANDOFF.md §5.7 — 쓰기 API가 성공을 반환해도 부분 기록 가능성이 있으므로
        // 같은 세션에서 즉시 다시 읽어 방금 쓴 내용과 바이트 단위로 대조한다.
        // "저장됨"이라고 말하는 시점이 실제로 검증된 시점이 되도록.
        try {
          const verifyTag = await NfcManager.ndefHandler.getNdefMessage();
          checkCancelled();
          const verifiedBytes = encodeNativeRecords(verifyTag?.ndefMessage ?? []);
          if (verifiedBytes.length !== bytes.length ||
              !verifiedBytes.every((byte, i) => byte === bytes[i])) return fail('verify_mismatch');
        } catch {
          checkCancelled();
          // 이미 썼으므로 재읽기/직렬화 오류도 기록 검증 실패로 처리한다.
          return fail('verify_mismatch');
        }

        if (Platform.OS === 'ios') {
          await NfcManager.setAlertMessage('저장 완료').catch(() => {});
        }
        checkCancelled();
        return { ok: true as const, message: '태그에 링크를 저장했습니다.', usedBytes: bytes.length, androidPackage };
      }, signal);
    } catch (err) {
      return fail(signal?.aborted ? 'cancelled' : classifyError(err));
    }
  },

  /** 단일 URL만 쓸 때의 편의 함수 (writeUrls의 얇은 래퍼) */
  async writeUrl(url: string): Promise<NfcResult> {
    return this.writeUrls([url]);
  },

  /** NFC 태그에서 URL 읽기. 첫 읽기 화면 이탈은 해당 요청의 signal로 취소한다. */
  async readUrl(signal?: AbortSignal): Promise<NfcReadResult> {
    try {
      const notReady = await ensureReady();
      if (notReady) return fail(notReady);
      return await withNdefSession('태그를 읽는 중입니다.\n휴대폰 뒷면을 태그에 대주세요.', async (connectedTech) => {
        const status = await getTagStatus(connectedTech);
        if (status.kind === 'unknown') return fail('status_unknown');
        if (status.kind === 'not_ndef') return fail('not_ndef');
        const tag = await NfcManager.getTag();
        if (!tag) return fail('failed');

        const records = tag?.ndefMessage;
        if (!records || records.length === 0 || records.every((record) => record.tnf === Ndef.TNF_EMPTY)) {
          // 기존 읽기 화면의 no_url 처리를 유지하면서 편집은 빈 태그로 시작할 수 있다.
          return {
            ...fail('no_url'),
            urls: [],
            capacity: status.capacity,
            writable: status.writable,
          };
        }

        const urls = extractUrls(records as never);
        const url = urls[0];
        if (!url) {
          return { ok: false, reason: 'no_url' as const, message: MESSAGES.no_url };
        }

        if (Platform.OS === 'ios') {
          await NfcManager.setAlertMessage('읽기 완료').catch(() => {});
        }

        let usedBytes: number | undefined;
        try { usedBytes = encodeNativeRecords(records as never).length; } catch { /* 조회값을 추정하지 않는다. */ }

        return {
          ok: true,
          url,
          urls,
          capacity: status.capacity,
          writable: status.writable,
          message: '태그를 읽었습니다.',
          aarRecords: readAarRecords(records),
          usedBytes,
        };
      }, signal);
    } catch (err) {
      const reason = signal?.aborted ? 'cancelled' : classifyError(err);
      return { ok: false, reason, message: MESSAGES[reason] };
    }
  },

  /**
   * ③ 태그 상태 확인 (HANDOFF §4.10) — 진단 전용. 태그를 한 번 읽기만 하고 쓰지 않는다.
   * URL이 없는 텍스트·혼합·빈 태그도 진단 대상이다. 상태를 확인하지 못하면 status_unknown.
   */
  async inspectTag(signal?: AbortSignal): Promise<NfcInspectResult> {
    try {
      const notReady = await ensureReady();
      if (notReady) return fail(notReady);
      return await withNdefSession('태그 상태를 확인하는 중입니다.\n휴대폰 뒷면을 태그에 대주세요.', async (connectedTech) => {
        const status = await getTagStatus(connectedTech);
        if (signal?.aborted) throw new Error('cancelled');
        if (status.kind === 'unknown') return fail('status_unknown');
        if (status.kind === 'not_ndef') {
          return { ok: true as const, state: 'not_ndef' as const, urls: [], message: '태그 상태를 확인했습니다.' };
        }
        const tag = await NfcManager.getTag();
        if (!tag) return fail('failed');

        // 진단은 태그에 실제로 기록된 레코드를 그대로 센다. TNF_EMPTY 레코드 1개도 3 B·1개이고,
        // 실제 무메시지 []만 0 B·0개다 (readUrl이 편집용으로 "빈 태그"로 취급하는 것과 별개).
        // Android 네이티브는 메시지가 없을 때와 조회가 비었을 때 모두 ndefMessage 필드를 빼므로
        // (Util.messageToJSON(null) → null → JSONObject.put이 키 제거) 배열이 아니면 []로 추정하지 않는다.
        const message = tag.ndefMessage as unknown;
        const records = Array.isArray(message) && message.every((r) => r && typeof r === 'object')
          ? message as NdefRecord[]
          : undefined;
        let usedBytes: number | undefined;
        if (records) {
          try {
            usedBytes = encodeNativeRecords(records).length;
          } catch {
            // 직렬화할 수 없으면 URL 기반 추정으로 채우지 않고 확인 불가로 둔다
          }
        }
        return {
          ok: true as const,
          state: status.writable ? 'read_write' as const : 'read_only' as const,
          capacity: status.capacity,
          usedBytes,
          recordCount: records?.length,
          urls: records ? extractUrls(records as never) : [],
          aarRecords: records ? readAarRecords(records) : undefined,
          message: '태그 상태를 확인했습니다.',
        };
      }, signal);
    } catch (err) {
      return fail(signal?.aborted ? 'cancelled' : classifyError(err));
    }
  },

  /** 앞선 NFC 세션의 정리(취소·이벤트 해제)가 끝날 때까지 기다린다. 다른 NFC 화면을 열기 전에 호출한다. */
  async whenIdle(): Promise<void> {
    await pendingNdefCleanup;
  },
};
