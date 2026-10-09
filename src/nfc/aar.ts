import { Ndef } from 'react-native-nfc-manager';
import { LINK_TYPES } from '../models/linkType';

/** 대표 URI부터 기록하고, 허용된 AAR 하나만 마지막에 붙인다. */
export function encodeLinkMessage(urls: string[], androidPackage?: string): number[] {
  const records = urls.map((url) => Ndef.uriRecord(url));
  if (androidPackage !== undefined) {
    if (!urls.length || !LINK_TYPES.some((type) => type.androidPackage === androidPackage)) {
      throw new Error('Unsupported Android package');
    }
    records.push(Ndef.androidApplicationRecord(androidPackage));
  }
  return Ndef.encodeMessage(records);
}

export interface AarRecord {
  packageName?: string;
}

/** 읽기/진단은 native AAR을 그대로 표시한다. 알 수 없는 패키지도 숨기지 않는다. */
export function readAarRecords(records: Array<{ tnf?: number; type?: unknown; payload?: unknown }>): AarRecord[] {
  const aarType = 'android.com:pkg';
  return records.filter((record) => record.tnf === Ndef.TNF_EXTERNAL_TYPE &&
    (record.type === aarType || (Array.isArray(record.type) && record.type.length === aarType.length &&
      record.type.every((byte, index) => byte === aarType.charCodeAt(index)))))
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
