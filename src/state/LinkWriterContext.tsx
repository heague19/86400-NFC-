// 링크 작성 상태 — Flutter link_writer_state.dart(ChangeNotifier) → React Context 이식본
//
// HANDOFF.md §2.1·T2a — 태그 하나에 여러 링크를 담고, 그중 하나를 "대표"로 지정한다.
// 대표는 항상 배열의 0번 인덱스. 대표 지정 버튼을 누르면 그 링크가 배열 맨 앞으로 이동한다.
// (드래그 순서 변경과는 별개 동작 — 대표는 오직 명시적 지정으로만 바뀐다.)

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { LinkType, UrlDraft } from '@/models/linkType';

interface LinkWriterContextValue {
  /** 태그에 쓸 링크 목록. 0번이 항상 대표(대표 개념 없는 "빈 목록" 상태만 예외). */
  links: UrlDraft[];
  /** LinkTypeSelect에서 고른 프리셋 — 계정명/URL 입력 화면이 이걸 참조 (신규 추가 시에만 의미 있음) */
  selectedLinkType: LinkType | null;
  selectLinkType: (linkType: LinkType) => void;
  /** 목록 맨 끝에 링크 추가 (첫 링크면 자동으로 대표가 됨) */
  addLink: (draft: UrlDraft) => void;
  /** 기존 링크 수정 (URL만 교체, 위치는 유지) */
  updateLink: (index: number, draft: UrlDraft) => void;
  /** 링크 삭제. 대표(0번)를 지우면 다음 항목이 자동으로 대표를 승계 */
  removeLink: (index: number) => void;
  /** 해당 인덱스를 대표로 지정 — 배열 맨 앞으로 이동 */
  setPrimary: (index: number) => void;
  /** 드래그 등으로 순서만 바꾸기 (대표 여부는 index 0 그대로 유지) */
  reorder: (fromIndex: number, toIndex: number) => void;
  clear: () => void;
}

const LinkWriterContext = createContext<LinkWriterContextValue | undefined>(undefined);

export function LinkWriterProvider({ children }: { children: React.ReactNode }) {
  const [links, setLinks] = useState<UrlDraft[]>([]);
  const [selectedLinkType, setSelectedLinkType] = useState<LinkType | null>(null);

  const selectLinkType = useCallback((linkType: LinkType) => {
    setSelectedLinkType(linkType);
  }, []);

  const addLink = useCallback((draft: UrlDraft) => {
    setLinks((prev) => [...prev, draft]);
  }, []);

  const updateLink = useCallback((index: number, draft: UrlDraft) => {
    setLinks((prev) => prev.map((item, i) => (i === index ? draft : item)));
  }, []);

  const removeLink = useCallback((index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setPrimary = useCallback((index: number) => {
    setLinks((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const next = [...prev];
      const [chosen] = next.splice(index, 1);
      next.unshift(chosen);
      return next;
    });
  }, []);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setLinks((prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setLinks([]);
    setSelectedLinkType(null);
  }, []);

  const value = useMemo<LinkWriterContextValue>(
    () => ({
      links,
      selectedLinkType,
      selectLinkType,
      addLink,
      updateLink,
      removeLink,
      setPrimary,
      reorder,
      clear,
    }),
    [links, selectedLinkType, selectLinkType, addLink, updateLink, removeLink, setPrimary, reorder, clear]
  );

  return <LinkWriterContext.Provider value={value}>{children}</LinkWriterContext.Provider>;
}

export function useLinkWriter(): LinkWriterContextValue {
  const ctx = useContext(LinkWriterContext);
  if (!ctx) {
    throw new Error('useLinkWriter must be used within a LinkWriterProvider');
  }
  return ctx;
}
