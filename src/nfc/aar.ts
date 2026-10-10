import { Ndef } from 'react-native-nfc-manager';
import type { NdefRecord } from 'react-native-nfc-manager';
import { LINK_TYPES } from '../models/linkType';

export type NativeNdefRecord = Omit<NdefRecord, 'id'> & { id?: number[] | string };

/** Native type=byte[], Android id=hex. 깊은 복사하며 무손실 직렬화가 불가능하면 거부한다. */
export function copyNativeRecords(records: NativeNdefRecord[]): NdefRecord[] {
  const validBytes = (value: unknown): value is number[] => Array.isArray(value) &&
    Array.from(value).every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  // shortcut: type은 설치된 codec의 문자열 왕복으로 동일한 byte[]일 때만 지원, 확장 시 raw codec 사용.
  if (!Array.isArray(records)) throw new Error('Invalid NDEF message');
  return Array.from(records, (record) => {
    if (!record || !Number.isInteger(record.tnf) || record.tnf < 0 || record.tnf > 5 ||
        !validBytes(record.payload) || (typeof record.type !== 'string' && !validBytes(record.type)) ||
        (record.id !== undefined && typeof record.id !== 'string' && !validBytes(record.id))) {
      throw new Error('Invalid native NDEF record');
    }
    const type = typeof record.type === 'string' ? record.type : Ndef.util.bytesToString(record.type);
    if (typeof type !== 'string' || (Array.isArray(record.type) &&
        Ndef.util.bytesToHexString(Ndef.util.stringToBytes(type)) !== Ndef.util.bytesToHexString(record.type))) {
      throw new Error('Invalid NDEF type');
    }
    if (typeof record.id === 'string' && !/^(?:[0-9a-f]{2})*$/i.test(record.id)) throw new Error('Invalid NDEF id');
    const id = typeof record.id === 'string'
      ? (record.id.match(/../g) ?? []).map((byte) => parseInt(byte, 16)) : [...(record.id ?? [])];
    const typeLength = Ndef.util.stringToBytes(type).length;
    if (typeLength > 255 || id.length > 255 || record.payload.length > 65535 ||
        (record.tnf === 0 && (typeLength || id.length || record.payload.length)) ||
        (record.tnf === 5 && typeLength !== 0) ||
        (record.tnf >= 1 && record.tnf <= 4 && typeLength === 0)) throw new Error('Invalid NDEF fields');
    return { tnf: record.tnf, type, id, payload: [...record.payload] };
  });
}

export function encodeNativeRecords(records: NativeNdefRecord[]): number[] {
  const bytes = Ndef.encodeMessage(copyNativeRecords(records));
  // shortcut: 설치된 codec은 65535 B 초과 payload를 안전하게 쓰지 못함, 더 큰 태그 지원 시 codec 교체.
  if (!bytes || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error('Invalid serialized NDEF message');
  }
  return bytes;
}

export function isAarRecord(record: { tnf?: number; type?: unknown }): boolean {
  const type = 'android.com:pkg';
  return !!record && record.tnf === Ndef.TNF_EXTERNAL_TYPE && (record.type === type ||
    (Array.isArray(record.type) && record.type.length === type.length &&
      record.type.every((byte, index) => byte === type.charCodeAt(index))));
}

/** 대표 URI → 나머지 URI → 보존 레코드 → 허용된 AAR 하나. */
export function encodeLinkMessage(urls: string[], androidPackage?: string, preservedRecords: NativeNdefRecord[] = []): number[] {
  const records = urls.map((url) => Ndef.uriRecord(url));
  records.push(...copyNativeRecords(preservedRecords).filter((record) => !isAarRecord(record)));
  if (androidPackage !== undefined) {
    if (!urls.length || !LINK_TYPES.some((type) => type.androidPackage === androidPackage)) {
      throw new Error('Unsupported Android package');
    }
    records.push(Ndef.androidApplicationRecord(androidPackage));
  }
  return encodeNativeRecords(records);
}

export interface AarRecord {
  packageName?: string;
}

/** 읽기/진단은 native AAR을 그대로 표시한다. 알 수 없는 패키지도 숨기지 않는다. */
export function readAarRecords(records: Array<{ tnf?: number; type?: unknown; payload?: unknown }>): AarRecord[] {
  return records.filter(isAarRecord)
    .map((record) => {
      try {
        const payload = record.payload;
        if (!Array.isArray(payload) || !payload.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
          return {};
        }
        const packageName = decodeURIComponent(payload.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
        return { packageName: packageName || undefined };
      } catch {
        return {};
      }
    });
}

export function aarLabel(record: AarRecord): string {
  return LINK_TYPES.find((type) => type.androidPackage === record.packageName && record.packageName)?.label
    ?? record.packageName ?? '패키지 확인 불가';
}
