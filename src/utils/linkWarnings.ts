// 경고 배지 규칙 — HANDOFF.md §4.3-5 · §5.6
//
// 같은 서비스 중복 · 허용 문자 위반 · 형식 이상은 배지로 알릴 뿐 추가·저장을 막지 않는다.
// 앱이 막는 것은 용량 초과 하나뿐이다. 경고는 입력 화면과 ② 목록에서 매번 목록으로부터 계산한다 —
// 중복 여부는 다른 행을 지우거나 고치면 달라지므로 입력 시점에 저장해 두지 않는다.

import type { UrlDraft } from '@/models/linkType';
import { normalizeCustomInput, normalizePresetInput, type LinkWarning, type LinkWarningKind } from '@/utils/urlNormalizer';

const WARNING_LABELS: Record<LinkWarningKind, string> = {
  duplicate: '중복',
  chars: '허용 문자 위반',
  format: '형식 이상',
};

/**
 * 중복 검사. 프리셋은 "같은 서비스", 기타는 "저장 URL이 완전히 같을 때만" (§4.6-5 · §5.1 E5).
 * selfIndex 행은 비교에서 뺀다 — 기존 행을 고칠 때 자기 자신을 중복으로 세지 않는다.
 */
export function findDuplicate(
  links: UrlDraft[],
  candidate: Pick<UrlDraft, 'linkType' | 'normalizedUrl'>,
  selfIndex?: number,
): LinkWarning | null {
  const others = links.filter((_, i) => i !== selfIndex);
  if (candidate.linkType.inputMode === 'username') {
    return others.some((l) => l.linkType.id === candidate.linkType.id)
      ? { kind: 'duplicate', message: `같은 서비스(${candidate.linkType.label}) 링크가 이미 있습니다.` }
      : null;
  }
  return others.some((l) => l.normalizedUrl === candidate.normalizedUrl)
    ? { kind: 'duplicate', message: '같은 URL이 이미 있습니다.' }
    : null;
}

/**
 * ② 목록 한 행에 붙는 경고. 태그에서 읽어 온 행은 경고하지 않는다 — 다른 앱이 써 둔 레코드는
 * 경고 없이 그대로 불러온다(§2.1 T3). 그 행과 겹치는 새 행에는 중복 경고가 붙는다.
 */
export function warningsForLink(links: UrlDraft[], index: number): LinkWarning[] {
  const link = links[index];
  if (!link || link.fromTag) return [];
  const own = link.linkType.inputMode === 'username'
    ? normalizePresetInput(link.linkType, link.originalInput).warnings
    : normalizeCustomInput(link.originalInput).warnings;
  const duplicate = findDuplicate(links, link, index);
  return duplicate ? [...own, duplicate] : own;
}

/** 경고 카드 제목(종류)과 본문(사유). 입력 화면과 ② 목록이 같은 문구를 쓴다. */
export function describeWarnings(warnings: LinkWarning[]): { title: string; message: string } {
  const kinds = [...new Set(warnings.map((w) => w.kind))];
  return {
    title: kinds.map((k) => WARNING_LABELS[k]).join(' · '),
    message: warnings.map((w) => w.message).join('\n'),
  };
}
