import { encodeNativeRecords, isAarRecord, type NativeNdefRecord } from '../nfc/aar';

/** 표시용 문자열만 만든다. 원본 필드와 payload는 수정하지 않는다. */
function decodeText(payload: number[]): { text: string; format: string } {
  if (!payload.length || (payload[0] & 0x40)) throw new Error('Invalid text status');
  const languageLength = payload[0] & 0x3f;
  if (1 + languageLength > payload.length) throw new Error('Missing language');
  const language = String.fromCharCode(...payload.slice(1, 1 + languageLength));
  if (language && !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(language)) throw new Error('Invalid language');
  const bytes = payload.slice(1 + languageLength);
  let text = '';
  let encoding = 'UTF-8';
  if (payload[0] & 0x80) {
    // BOM이 없으면 UTF-16BE. BOM이 있으면 그 바이트 순서를 따른다.
    const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe;
    const hasBom = littleEndian || (bytes[0] === 0xfe && bytes[1] === 0xff);
    encoding = littleEndian ? 'UTF-16LE' : 'UTF-16BE';
    if (bytes.length % 2) throw new Error('Truncated UTF-16');
    const unitAt = (i: number) => littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
    for (let i = hasBom ? 2 : 0; i < bytes.length; i += 2) {
      const unit = unitAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (i + 3 >= bytes.length) throw new Error('Missing surrogate');
        const low = unitAt(i + 2);
        if (low < 0xdc00 || low > 0xdfff) throw new Error('Invalid surrogate');
        text += String.fromCharCode(unit, low);
        i += 2;
      } else {
        if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error('Invalid surrogate');
        text += String.fromCharCode(unit);
      }
    }
  } else {
    // React Native의 TextDecoder 지원 여부에 의존하지 않는 엄격한 UTF-8 해석.
    text = decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Non-displayable text');
  return { text, format: `${encoding}${language ? ` · ${language}` : ''}` };
}

export function preservedRecordDisplay(records: NativeNdefRecord[]) {
  return records.filter((record) => record.tnf !== 0 && !isAarRecord(record)).map((record) => {
    const type = typeof record.type === 'string' ? record.type : String.fromCharCode(...record.type);
    const readableType = /^[\x20-\x7e]+$/.test(type) ? type : type
      ? `0x${Array.from(type, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}` : '타입 없음';
    const kind = record.tnf === 1 && type === 'T' ? '텍스트 기록'
      : record.tnf === 1 && type === 'U' ? 'URI 기록'
      : record.tnf === 2 ? 'MIME 기록'
      : record.tnf === 3 ? '절대 URI 기록'
      : record.tnf === 4 ? '외부 형식 기록' : '알 수 없는 기록';
    let content = '이 형식의 내용은 표시할 수 없습니다.';
    let format = readableType;
    if (record.tnf === 1 && type === 'T') {
      try {
        const decoded = decodeText(record.payload);
        content = decoded.text.trim() ? decoded.text : '텍스트 내용이 비어 있습니다.';
        format = `${readableType} · ${decoded.format}`;
      } catch { content = '텍스트 내용을 해석할 수 없습니다.'; }
    }
    return {
      kind,
      metadata: `TNF ${record.tnf} · ${format} · 레코드 ${encodeNativeRecords([record]).length} B · 내용 ${record.payload.length} B`,
      content,
    };
  });
}
