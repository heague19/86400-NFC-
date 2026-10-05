// Native responder 기반 터치 핸들. 외부 라이브러리/네이티브 의존성 없음.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WriterLink } from '@/state/LinkWriterContext';
import { AppColors, AppSpacing, AppText } from '@/theme/tokens';

type Props = {
  links: WriterLink[];
  cancelToken: number;
  header: React.ReactNode;
  footer: React.ReactNode;
  renderRow: (link: WriterLink, index: number) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  onDragging: (dragging: boolean) => void;
};
type Drag = { id: string; target: string; pageY: number };
type Layout = { y: number; height: number };

function DragHandle({ disabled, start, move, end }: {
  disabled: boolean; start: (y: number) => void; move: (y: number) => void; end: (cancel: boolean) => void;
}) {
  const latest = useRef({ disabled, start, move, end });
  latest.current = { disabled, start, move, end };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: (event) => latest.current.start(event.nativeEvent.pageY),
    onPanResponderMove: (event) => latest.current.move(event.nativeEvent.pageY),
    onPanResponderRelease: (event) => { latest.current.move(event.nativeEvent.pageY); latest.current.end(false); },
    onPanResponderTerminate: () => latest.current.end(true),
    onPanResponderTerminationRequest: () => false,
  }), []);
  return <View {...responder.panHandlers} style={styles.handle}
    accessibilityLabel={disabled ? '대표 링크 순서 고정' : '끌어서 링크 순서 변경'}
    accessibilityState={{ disabled }}>
    <Text style={[AppText.titleMedium, { opacity: disabled ? 0.3 : 1 }]}>≡</Text>
  </View>;
}

export function DraggableLinkList(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const scroll = useRef<ScrollView>(null);
  const viewportView = useRef<View>(null);
  const layouts = useRef(new Map<string, Layout>());
  const viewport = useRef({ top: 0, height: 0, content: 0, offset: 0, listTop: 0 });
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);

  const end = useCallback((cancel: boolean) => {
    const current = drag.current;
    drag.current = null;
    if (frame.current !== null) clearTimeout(frame.current);
    frame.current = null;
    setPreview(null);
    latest.current.onDragging(false);
    if (cancel || !current || current.pageY < viewport.current.top ||
        current.pageY > viewport.current.top + viewport.current.height) return;
    const from = latest.current.links.findIndex((link) => link.rowId === current.id);
    const to = latest.current.links.findIndex((link) => link.rowId === current.target);
    if (from > 0 && to > 0) latest.current.onReorder(from, to);
  }, []);

  const updateTarget = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    const v = viewport.current;
    const y = current.pageY - v.top + v.offset - v.listTop;
    const rows = latest.current.links.slice(1);
    let target = current.id;
    let distance = Infinity;
    for (const row of rows) {
      const layout = layouts.current.get(row.rowId);
      if (!layout) continue;
      const nextDistance = Math.abs(y - layout.y - layout.height / 2);
      if (nextDistance < distance) { target = row.rowId; distance = nextDistance; }
    }
    if (target !== current.target) {
      current.target = target;
      setPreview({ ...current });
    }
  }, []);

  const tick = useCallback(function autoScroll() {
    const current = drag.current;
    if (!current) return;
    const v = viewport.current;
    const localY = current.pageY - v.top;
    const delta = localY < 60 ? -10 : localY > v.height - 60 ? 10 : 0;
    const offset = Math.max(0, Math.min(Math.max(0, v.content - v.height), v.offset + delta));
    if (offset !== v.offset) {
      v.offset = offset;
      scroll.current?.scrollTo({ y: offset, animated: false });
    }
    updateTarget();
    frame.current = setTimeout(autoScroll, 16);
  }, [updateTarget]);

  const start = (id: string, pageY: number) => {
    if (latest.current.links.findIndex((link) => link.rowId === id) <= 0) return;
    end(true);
    drag.current = { id, target: id, pageY };
    setPreview({ ...drag.current });
    props.onDragging(true);
    // 실제 화면 좌표를 사용하므로 헤더/안전 영역/스크롤 위치에 의존하지 않는다.
    viewportView.current?.measureInWindow((_x, top, _width, height) => {
      if (drag.current?.id !== id) return;
      Object.assign(viewport.current, { top, height });
      updateTarget();
    });
    frame.current = setTimeout(tick, 16);
  };
  const move = (pageY: number) => {
    if (!drag.current) return;
    drag.current.pageY = pageY;
    updateTarget();
  };

  useEffect(() => () => {
    drag.current = null;
    if (frame.current !== null) clearTimeout(frame.current);
    latest.current.onDragging(false);
  }, []);
  useEffect(() => {
    // 편집/삭제/경고 변화로 행의 내용이나 높이가 바뀌면 안전하게 드롭을 취소한다.
    if (drag.current) end(true);
    const ids = new Set(props.links.map((link) => link.rowId));
    for (const id of layouts.current.keys()) if (!ids.has(id)) layouts.current.delete(id);
  }, [props.links, end]);

  useEffect(() => { if (drag.current) end(true); }, [props.cancelToken, end]);

  return <View ref={viewportView} collapsable={false} style={{ flex: 1 }}><ScrollView ref={scroll} contentContainerStyle={styles.content}
    scrollEnabled={!preview} scrollEventThrottle={16}
    onScroll={(event) => { viewport.current.offset = event.nativeEvent.contentOffset.y; updateTarget(); }}
    onContentSizeChange={(_width, height) => { viewport.current.content = height; }}
    onLayout={(event) => {
      if (drag.current) end(true);
      viewport.current.height = event.nativeEvent.layout.height;
    }}>
    {props.header}
    <View onLayout={(event) => {
      if (drag.current && viewport.current.listTop !== event.nativeEvent.layout.y) end(true);
      viewport.current.listTop = event.nativeEvent.layout.y;
    }}>
      {props.links.map((link, index) => <View key={link.rowId}
        onLayout={(event) => {
          const layout = event.nativeEvent.layout;
          const old = layouts.current.get(link.rowId);
          if (drag.current && old && (old.y !== layout.y || old.height !== layout.height)) end(true);
          layouts.current.set(link.rowId, { y: layout.y, height: layout.height });
        }} style={[styles.row, preview?.id === link.rowId && styles.active,
          preview?.target === link.rowId && preview.id !== link.rowId && styles.target]}>
        <DragHandle disabled={index === 0} start={(y) => start(link.rowId, y)} move={move} end={end} />
        <View style={{ flex: 1 }}>{props.renderRow(link, index)}</View>
      </View>)}
    </View>
    {preview ? <Text style={AppText.bodyMedium}>핸들을 놓으면 선택한 위치로 이동합니다. 대표는 유지됩니다.</Text> : null}
    {props.footer}
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: AppSpacing.screenPadding, paddingTop: 8, paddingBottom: 20 },
  row: { flexDirection: 'row', borderWidth: 2, borderColor: 'transparent', borderRadius: 12 },
  handle: { width: 36, paddingVertical: 24, alignItems: 'center' },
  active: { borderColor: AppColors.primary, opacity: 0.65 },
  target: { borderColor: AppColors.primary, backgroundColor: AppColors.cardBackground },
});
