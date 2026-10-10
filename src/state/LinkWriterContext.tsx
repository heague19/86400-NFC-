// 링크 작성 상태 — Flutter link_writer_state.dart(ChangeNotifier) → React Context 이식본
//
// HANDOFF.md §2.1·T2a — 태그 하나에 여러 링크를 담고, 그중 하나를 "대표"로 지정한다.
// 대표는 항상 배열의 0번 인덱스. 대표 지정 버튼을 누르면 그 링크가 배열 맨 앞으로 이동한다.
// (드래그 순서 변경과는 별개 동작 — 대표는 오직 명시적 지정으로만 바뀐다.)

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import type { LinkType, UrlDraft } from '@/models/linkType';
import { CUSTOM_LINK_TYPE, detectLinkTypeFromUrl } from '@/models/linkType';
import { copyNativeRecords, isAarRecord, type NativeNdefRecord } from '@/nfc/aar';
import { NdefSize } from '@/utils/ndefSize';
import { extractPresetHandle } from '@/utils/urlNormalizer';

export interface WriterLink extends UrlDraft {
  /** 편집 세션 내 행 식별자. URL 중복과 수정에도 유지한다. */
  rowId: string;
}

let nextRowId = 0;
const rowId = () => `link-${++nextRowId}`;

interface LinkWriterContextValue {
  /** 태그에 쓸 링크 목록. 0번이 항상 대표(대표 개념 없는 "빈 목록" 상태만 예외). */
  links: WriterLink[];
  preservedRecords: NativeNdefRecord[];
  aarEnabled: boolean;
  primaryRevision: number;
  /** 고지 당시 대표 객체와 지금 대표가 같을 때만 켠다. */
  enableAar: (primary: WriterLink, revision: number) => void;
  disableAar: () => void;
  /** 현재 편집 중인 태그에서 조회한 실제 용량. 입력 화면에 다녀와도 유지한다. */
  capacity: number | undefined;
  /** 새 태그의 전체 URL로 교체. 읽은 문자열과 순서, 중복을 그대로 보존한다. */
  replaceFromTag: (urls: string[], capacity: number, preservedRecords?: NativeNdefRecord[]) => void;
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
  /** 드래그로 비대표 순서만 바꾸기. 0번으로/0번에서 이동은 무시한다 */
  reorder: (fromIndex: number, toIndex: number) => void;
  clear: () => void;
}

const LinkWriterContext = createContext<LinkWriterContextValue | undefined>(undefined);

export function LinkWriterProvider({ children }: { children: React.ReactNode }) {
  const [writer, setWriter] = useState<{ links: WriterLink[]; aarEnabled: boolean; primaryRevision: number }>({ links: [], aarEnabled: false, primaryRevision: 0 });
  const { links, aarEnabled, primaryRevision } = writer;
  const setLinks = useCallback((update: WriterLink[] | ((prev: WriterLink[]) => WriterLink[])) => {
    setWriter((prev) => {
      const next = typeof update === 'function' ? update(prev.links) : update;
      const samePrimary = next[0] === prev.links[0];
      return { links: next, aarEnabled: samePrimary && prev.aarEnabled,
        primaryRevision: prev.primaryRevision + (samePrimary ? 0 : 1) };
    });
  }, []);
  const disableAar = useCallback(() => setWriter((prev) => ({ ...prev, aarEnabled: false, primaryRevision: prev.primaryRevision + 1 })), []);
  const enableAar = useCallback((primary: WriterLink, revision: number) => {
    setWriter((prev) => Platform.OS === 'android' && prev.primaryRevision === revision && prev.links[0] === primary && primary.linkType.androidPackage
      ? { ...prev, aarEnabled: true } : prev);
  }, []);
  const [preservedRecords, setPreservedRecords] = useState<NativeNdefRecord[]>([]);
  const [capacity, setCapacity] = useState<number | undefined>(undefined);
  const [selectedLinkType, setSelectedLinkType] = useState<LinkType | null>(null);

  const replaceFromTag = useCallback((urls: string[], tagCapacity: number, records: NativeNdefRecord[] = []) => {
    const preserved = copyNativeRecords(records).filter((record) => !isAarRecord(record));
    setLinks(urls.map((url) => {
      // 도메인만 같다고 프리셋으로 분류하지 않는다 — github.com/org/repo, youtube.com/watch?v=… 같은 URL을
      // 계정명 화면으로 열면 엉뚱한 URL이 조립된다. 계정 페이지가 아니면 기타로 둔다. 문자열·순서는 그대로.
      const detected = detectLinkTypeFromUrl(url);
      return {
        rowId: rowId(),
        linkType: detected && extractPresetHandle(detected, url) !== null ? detected : CUSTOM_LINK_TYPE,
        originalInput: url,
        normalizedUrl: url,
        estimatedBytes: NdefSize.estimateUrlRecordBytes(url),
        isValid: true,
        fromTag: true,
      };
    }));
    setPreservedRecords(preserved);
    disableAar();
    setCapacity(tagCapacity);
    setSelectedLinkType(null);
  }, [setLinks, disableAar]);

  const selectLinkType = useCallback((linkType: LinkType) => {
    setSelectedLinkType(linkType);
  }, []);

  const addLink = useCallback((draft: UrlDraft) => {
    setLinks((prev) => [...prev, { ...draft, rowId: rowId() }]);
  }, [setLinks]);

  const updateLink = useCallback((index: number, draft: UrlDraft) => {
    setLinks((prev) => prev.map((item, i) => (i === index ? { ...draft, rowId: item.rowId } : item)));
  }, [setLinks]);

  const removeLink = useCallback((index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }, [setLinks]);

  const setPrimary = useCallback((index: number) => {
    setLinks((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const next = [...prev];
      const [chosen] = next.splice(index, 1);
      next.unshift(chosen);
      return next;
    });
  }, [setLinks]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setLinks((prev) => {
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex === toIndex ||
        fromIndex <= 0 ||
        toIndex <= 0 ||
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
  }, [setLinks]);

  const clear = useCallback(() => {
    setLinks([]);
    setPreservedRecords([]);
    setCapacity(undefined);
    setSelectedLinkType(null);
    disableAar();
  }, [setLinks, disableAar]);

  const value = useMemo<LinkWriterContextValue>(
    () => ({
      links,
      preservedRecords,
      aarEnabled,
      primaryRevision,
      enableAar,
      disableAar,
      capacity,
      replaceFromTag,
      selectedLinkType,
      selectLinkType,
      addLink,
      updateLink,
      removeLink,
      setPrimary,
      reorder,
      clear,
    }),
    [links, preservedRecords, aarEnabled, primaryRevision, enableAar, disableAar, capacity, replaceFromTag, selectedLinkType, selectLinkType, addLink, updateLink, removeLink, setPrimary, reorder, clear]
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
