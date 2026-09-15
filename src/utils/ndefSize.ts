// NDEF 용량 계산 — Flutter ndef_size_calculator.dart 이식본
// NTAG213 = 144 bytes 사용자 메모리 기준

const MAX_BYTES = 144;
// 레코드 하나 = 헤더 4 B + URI prefix 코드 1 B + URL 본문
const RECORD_HEADER_BYTES = 4;
const URI_PREFIX_CODE_BYTES = 1;

/**
 * NDEF URI 레코드는 흔한 접두사를 1바이트 코드로 압축한다.
 * (0x04 = https://, 0x02 = https://www.)
 * 이 압축을 계산에 넣지 않으면 실제보다 훨씬 크게 나온다.
 */
const URI_PREFIXES: Array<{ code: number; prefix: string }> = [
  { code: 0x02, prefix: 'https://www.' },
  { code: 0x03, prefix: 'http://www.' },
  { code: 0x04, prefix: 'https://' },
  { code: 0x01, prefix: 'http://' },
];

/** 가장 길게 압축되는 접두사를 찾아 본문만 남긴다 */
function stripUriPrefix(url: string): string {
  for (const { prefix } of URI_PREFIXES) {
    if (url.toLowerCase().startsWith(prefix)) {
      return url.slice(prefix.length);
    }
  }
  return url;
}

// UTF-8 바이트 길이 (RN에 TextEncoder 있음 / 폴백 포함)
function utf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return unescape(encodeURIComponent(str)).length;
}

export const NdefSize = {
  maxBytes: MAX_BYTES,

  /** URI 레코드 1개가 차지하는 바이트 (접두사 압축 반영) */
  estimateUrlRecordBytes(url: string): number {
    return (
      RECORD_HEADER_BYTES +
      URI_PREFIX_CODE_BYTES +
      utf8ByteLength(stripUriPrefix(url))
    );
  },

  /** 여러 링크를 한 태그에 쓸 때의 합계 */
  estimateMessageBytes(urls: string[]): number {
    return urls.reduce((sum, u) => sum + this.estimateUrlRecordBytes(u), 0);
  },

  canStoreInNtag213(url: string): boolean {
    return this.estimateUrlRecordBytes(url) <= MAX_BYTES;
  },

  /** 여러 링크를 태그에 담을 때 용량(옵션: 실측값) 이내인지 */
  canStoreAll(urls: string[], capacity: number = MAX_BYTES): boolean {
    return this.estimateMessageBytes(urls) <= capacity;
  },
};
