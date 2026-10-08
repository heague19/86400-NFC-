import { Ndef } from 'react-native-nfc-manager';

export const NdefSize = {
  /** 조회한 NDEF 메시지 용량만 사용한다. 불명·0·잘못된 값은 분모가 될 수 없다. */
  isValidCapacity(capacity: unknown): capacity is number {
    return typeof capacity === 'number' && Number.isSafeInteger(capacity) && capacity > 0;
  },

  /** 쓰기 서비스와 같은 URI 레코드를 직렬화한 실제 바이트 길이. */
  estimateUrlRecordBytes(url: string): number {
    return this.estimateMessageBytes([url]);
  },

  /** 빈 목록은 0 B, 나머지는 전체 NDEF 메시지를 실제 직렬화한다. */
  estimateMessageBytes(urls: string[]): number {
    return urls.length === 0 ? 0 : Ndef.encodeMessage(urls.map((url) => Ndef.uriRecord(url))).length;
  },

  /** 용량을 모르면 저장 가능하다고 판단하지 않는다. */
  canStoreAll(urls: string[], capacity: unknown): boolean {
    return this.isValidCapacity(capacity) && this.estimateMessageBytes(urls) <= capacity;
  },
};
