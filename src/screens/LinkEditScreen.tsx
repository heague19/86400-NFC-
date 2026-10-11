// 수정/만들기 화면 — HANDOFF.md §4.3
// 태그 접촉 2회(읽기 1 + 저장 1)가 일어나는 유일한 화면.
// 목록에 링크를 쌓고, 대표를 지정하고, 용량을 확인한 뒤 한 번에 태그에 쓴다.
//
// 홈에서는 먼저 읽는다. 전달받은 읽기 결과와 같은 편집의 입력 화면 복귀는 재읽기하지 않는다.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, findNodeHandle, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { DraggableLinkList } from '@/components/DraggableLinkList';
import { WriteWaitingScreen } from '@/screens/WriteWaitingScreen';
import { WriteFailureScreen } from '@/screens/WriteFailureScreen';
import { AppCapacityGauge } from '@/components/AppCapacityGauge';
import { CUSTOM_LINK_TYPE } from '@/models/linkType';
import { useLinkWriter, type WriterLink } from '@/state/LinkWriterContext';
import { NfcService, type NfcWriteStage } from '@/nfc/nfcService';
import { describeWarnings, warningsForLink } from '@/utils/linkWarnings';
import { aarLabel, copyNativeRecords, isAarRecord, readAarRecords, type NativeNdefRecord } from '@/nfc/aar';
import { NdefSize } from '@/utils/ndefSize';
import { hostOf } from '@/utils/urlNormalizer';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type AarNotice = { primary: WriterLink; revision: number };

type Props = NativeStackScreenProps<RootStackParamList, 'LinkEdit'>;

export function LinkEditScreen({ navigation, route }: Props) {
  const { links, preservedRecords, capacity, aarEnabled, androidPackage, primaryRevision, enableAar, disableAar, replaceFromTag, clear, removeLink, setPrimary, reorder } = useLinkWriter();
  const [aarNotice, setAarNotice] = useState<AarNotice | null>(null);
  const consent = useRef<AarNotice | null>(null);
  const declineButton = useRef<View>(null);
  const dismissNotice = useCallback(() => {
    consent.current = null;
    setAarNotice(null);
  }, []);
  const failedWrite = useRef<{ urls: string[]; androidPackage?: string; preservedRecords: NativeNdefRecord[]; links: WriterLink[] } | null>(null);
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readTimedOut, setReadTimedOut] = useState(false);
  // 읽기 전용·NDEF 아님·상태 조회 실패 — ③ 태그 상태 확인으로 안내할 이상 (D8)
  const [diagnosable, setDiagnosable] = useState(false);
  const diagnosing = useRef(false);
  const readRequest = useRef(0);
  const readPending = useRef(false);
  const readCancellation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [writing, setWriting] = useState(false);
  const [writeStage, setWriteStage] = useState<NfcWriteStage>('waiting');
  const writePending = useRef(false);
  const writeRequest = useRef(0);
  const writeCancellation = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragEpoch, setDragEpoch] = useState(0);

  const cancelWrite = useCallback(() => {
    ++writeRequest.current;
    writeCancellation.current?.abort();
    writeCancellation.current = null;
    writePending.current = false;
    setWriting(false);
  }, []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [writeTimedOut, setWriteTimedOut] = useState(false);

  const onRead = useCallback(async () => {
    if (readPending.current || !navigation.isFocused()) return;
    const request = ++readRequest.current;
    const cancellation = new AbortController();
    readCancellation.current = cancellation;
    readPending.current = true;
    failedWrite.current = null;
    setReady(false);
    setReading(true);
    setReadError(null);
    setReadTimedOut(false);
    setDiagnosable(false);
    clear(); // 읽기 전 이전 태그의 목록과 용량을 사용할 수 없게 한다.
    try {
      const result = await NfcService.readUrl(cancellation.signal);
      if (!mounted.current || request !== readRequest.current || !navigation.isFocused()) return;
      setReadTimedOut(result.reason === 'timeout');
      const urls = result.ok
        ? result.urls ?? (result.url ? [result.url] : undefined)
        : result.reason === 'no_url' && result.urls?.length === 0 ? result.urls : undefined;
      if (urls && result.writable === true && typeof result.capacity === 'number' &&
          Number.isSafeInteger(result.capacity) && result.capacity > 0) {
        replaceFromTag(urls, result.capacity, result.preservedRecords);
        setReady(true);
      } else {
        setDiagnosable(result.writable === false || result.ok ||
          result.reason === 'not_ndef' || result.reason === 'status_unknown' || result.reason === 'invalid_records');
        setReadError(result.writable === false
          ? '이 태그는 읽기 전용이라 수정할 수 없습니다.'
          : result.ok ? '태그 상태를 확인할 수 없습니다. 다시 읽어주세요.' : result.message);
      }
    } catch {
      if (mounted.current && request === readRequest.current && navigation.isFocused()) {
        setReadError('태그를 읽지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (mounted.current && request === readRequest.current) {
        readPending.current = false;
        readCancellation.current = null;
        setReading(false);
      }
    }
  }, [navigation, clear, replaceFromTag]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation.addListener('blur', () => {
      dismissNotice();
      setDragEpoch((value) => value + 1);
      if (writePending.current) cancelWrite();
      ++readRequest.current;
      if (readPending.current) {
        readCancellation.current?.abort();
        readCancellation.current = null;
        readPending.current = false;
        setReading(false);
        setReadError('태그 읽기가 중단되었습니다. 다시 읽어주세요.');
      }
    });
    failedWrite.current = null;
    setReady(false);
    setReadError(null);
    setReadTimedOut(false);
    setDiagnosable(false);
    if (route.params) {
      const { urls, preservedRecords: records, capacity: tagCapacity, writable } = route.params;
      clear();
      if (writable !== false && typeof tagCapacity === 'number' &&
          Number.isSafeInteger(tagCapacity) && tagCapacity > 0) {
        try {
          if (Platform.OS !== 'android' && records?.length) throw new Error('Unsupported record preservation');
          replaceFromTag(urls, tagCapacity, records);
          setReady(true);
        } catch {
          setDiagnosable(true);
          setReadError('기존 기록을 안전하게 보존할 수 없습니다. 다시 읽거나 태그 상태를 확인해주세요.');
        }
      } else {
        setDiagnosable(true);
        setReadError(writable === false
          ? '이 태그는 읽기 전용이라 수정할 수 없습니다.'
          : '태그 상태를 확인할 수 없습니다. 다시 읽어주세요.');
      }
    } else {
      void onRead();
    }
    return () => {
      mounted.current = false;
      ++writeRequest.current;
      writeCancellation.current?.abort();
      writeCancellation.current = null;
      writePending.current = false;
      ++readRequest.current;
      if (readPending.current) readCancellation.current?.abort();
      readCancellation.current = null;
      readPending.current = false;
      unsubscribe();
    };
  }, [navigation, route.params, clear, replaceFromTag, onRead, cancelWrite, dismissNotice]);

  const primary = links[0];
  useEffect(() => {
    if (consent.current && (consent.current.primary !== primary || consent.current.revision !== primaryRevision)) dismissNotice();
  }, [primary, primaryRevision, dismissNotice]);

  const urls = links.map((l) => l.normalizedUrl);
  const existingAars = readAarRecords(preservedRecords);
  const linkBytes = NdefSize.estimateMessageBytes(urls);
  const aarBytes = androidPackage ? NdefSize.aarBytes(androidPackage)
    : NdefSize.estimateMessageBytes([], undefined, preservedRecords.filter(isAarRecord));
  const usedBytes = NdefSize.estimateMessageBytes(urls, androidPackage, Platform.OS === 'android' ? preservedRecords : []);
  const totalCapacity = NdefSize.isValidCapacity(capacity) ? capacity : undefined;
  const overCapacity = totalCapacity !== undefined && usedBytes > totalCapacity;
  const cannotSave = totalCapacity === undefined || overCapacity;

  const onAarChange = (enabled: boolean) => {
    if (!ready || reading || writePending.current || dragging || !navigation.isFocused() || Platform.OS !== 'android') return;
    if (!enabled) { dismissNotice(); disableAar(); return; }
    if (!primary?.linkType.androidPackage || consent.current) return;
    const notice = { primary, revision: primaryRevision };
    consent.current = notice;
    setAarNotice(notice);
  };

  const onAcceptAar = () => {
    if (aarNotice && consent.current === aarNotice && mounted.current && navigation.isFocused() && ready && !writePending.current) {
      enableAar(aarNotice.primary, aarNotice.revision);
    }
    dismissNotice();
  };

  /**
   * 이상 안내·쓰기 실패 → ③ 태그 상태 확인 (D8·I4). 앞선 NFC 세션의 정리가 끝난 뒤에 연다.
   * ③의 나가는 길은 홈뿐이므로 ②를 남기지 않고 [홈, ③]으로 연다. 편집 중인 링크는 지우지 않는다
   * (다음 ② 진입은 K13대로 태그를 새로 읽어 교체한다).
   */
  const onOpenDiagnosis = async () => {
    if (diagnosing.current || readPending.current || writePending.current || !navigation.isFocused()) return;
    diagnosing.current = true;
    const request = readRequest.current;
    try {
      await NfcService.whenIdle();
      if (!mounted.current || request !== readRequest.current || !navigation.isFocused()) return;
      navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'TagInfo' }] });
    } finally {
      diagnosing.current = false;
    }
  };

  const onAddLink = () => {
    if (!ready || reading || writePending.current || dragging || !navigation.isFocused()) return;
    navigation.navigate('LinkTypeSelect');
  };

  const onEditLink = (index: number) => {
    if (!ready || reading || writePending.current || dragging || !navigation.isFocused()) return;
    const link = links[index];
    if (link.linkType.inputMode === 'username') {
      navigation.navigate('InstagramInput', { editIndex: index });
    } else {
      navigation.navigate('CustomUrlInput', { editIndex: index });
    }
  };

  const onPrimary = (index: number) => {
    if (dragging || writePending.current || !navigation.isFocused()) return;
    setPrimary(index);
  };

  const onRemoveLink = (index: number) => {
    if (dragging || writePending.current || !navigation.isFocused()) return;
    Alert.alert('링크 삭제', '이 링크를 목록에서 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => {
        if (!dragging && !writePending.current && navigation.isFocused()) removeLink(index);
      } },
    ]);
  };

  const onSave = async () => {
    const saved = failedWrite.current ?? { urls: [...urls], androidPackage, preservedRecords: copyNativeRecords(preservedRecords), links: [...links] };
    if (!ready || reading || writePending.current || dragging || consent.current || !navigation.isFocused() ||
        saved.urls.length === 0 || !NdefSize.canStoreAll(saved.urls, capacity, saved.androidPackage, Platform.OS === 'android' ? saved.preservedRecords : [])) return;
    const request = ++writeRequest.current;
    const cancellation = new AbortController();
    writeCancellation.current = cancellation;
    writePending.current = true; // 렌더 전 연속 탭도 한 번만 저장한다.
    const snapshot = saved.urls;
    setWriteStage('waiting');
    setWriting(true);
    setErrorMsg(null);
    setWriteTimedOut(false);
    const active = () => mounted.current && request === writeRequest.current &&
      !cancellation.signal.aborted && navigation.isFocused();
    try {
      const result = await NfcService.writeUrls(snapshot, {
        androidPackage: saved.androidPackage,
        preservedRecords: saved.preservedRecords,
        signal: cancellation.signal,
        onStage: (stage) => { if (active()) setWriteStage(stage); },
      });
      if (!active()) return;
      // 완료 이동의 blur에서 이미 끝난 요청을 취소하지 않도록 먼저 해제한다.
      writePending.current = false;
      writeCancellation.current = null;
      setWriting(false);
      if (result.ok) {
        failedWrite.current = null;
        navigation.navigate('WriteComplete', { urls: snapshot, usedBytes: result.usedBytes, androidPackage: result.androidPackage });
      } else if (result.reason !== 'cancelled') {
        failedWrite.current = saved;
        setWriteTimedOut(result.reason === 'timeout');
        setErrorMsg(result.message);
      }
    } catch {
      if (active()) {
        failedWrite.current = saved;
        setErrorMsg('쓰기를 완료하지 못했습니다. 편집 내용은 유지됩니다. 전체 재쓰기로 다시 기록해주세요.');
      }
    } finally {
      if (mounted.current && request === writeRequest.current) {
        writePending.current = false;
        writeCancellation.current = null;
        setWriting(false);
      }
    }
  };

  if (writing) return <WriteWaitingScreen stage={writeStage} onCancel={cancelWrite} />;
  if (errorMsg) return <WriteFailureScreen message={errorMsg} timedOut={writeTimedOut} links={failedWrite.current?.links ?? links} capacity={capacity}
    onRewrite={onSave} onEdit={() => { failedWrite.current = null; setErrorMsg(null); }} onDiagnose={onOpenDiagnosis} />;

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={AppText.headlineLarge}>태그를 먼저 읽으세요</Text>
          <View style={{ height: AppSpacing.sm }} />
          <Text style={AppText.bodyMedium}>휴대폰 뒷면을 태그에 대면 기존 링크를 불러옵니다.</Text>
          {readError ? (
            <>
              <View style={{ height: AppSpacing.lg }} />
              <AppInfoCard title={readTimedOut ? '시간 초과' : '태그 읽기'} message={readError} variant="error" />
            </>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <AppPrimaryButton label={reading ? '태그를 대세요…' : readTimedOut ? '다시 시도' : '다시 읽기'} onPress={onRead} loading={reading} />
          {diagnosable ? (
            <>
              <View style={{ height: AppSpacing.itemGap }} />
              <AppSecondaryButton label="태그 상태 확인" onPress={onOpenDiagnosis} />
            </>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {Platform.OS === 'android' ? <View style={styles.aarPanel}>
        <Text style={AppText.titleMedium}>{`현재 대표: ${primary ? primary.linkType.id === CUSTOM_LINK_TYPE.id ? hostOf(primary.normalizedUrl) : primary.linkType.label : '없음'}`}</Text>
        <View style={styles.aarToggle}>
          <Text style={AppText.bodyMedium}>안드로이드에서 앱 바로 열기</Text>
          {primary?.linkType.androidPackage || existingAars.length ? <Switch accessibilityLabel="안드로이드에서 앱 바로 열기"
            accessibilityState={{ checked: aarEnabled, disabled: dragging || reading || !!aarNotice }}
            value={aarEnabled} onValueChange={onAarChange} disabled={dragging || reading || !!aarNotice} />
            : <Text style={AppText.labelSmall}>사용 불가</Text>}
        </View>
        {existingAars.length ? <Text style={AppText.bodyMedium}>{`기존 앱 설정 유지: ${existingAars.map(aarLabel).join(', ')}`}</Text> : null}
        {existingAars.length && primary?.linkType.androidPackage &&
          (existingAars.length !== 1 || existingAars[0].packageName !== primary.linkType.androidPackage) ?
          <AppSecondaryButton label="대표 앱으로 변경" onPress={() => onAarChange(true)} disabled={dragging || reading || !!aarNotice} /> : null}
      </View> : null}
      <DraggableLinkList links={links} cancelToken={dragEpoch}
        onReorder={(from, to) => { if (navigation.isFocused() && !writePending.current) reorder(from, to); }}
        onDragging={setDragging}
        header={<>
            <Text style={AppText.headlineLarge}>링크를 편집하세요</Text>
            <View style={{ height: AppSpacing.sm }} />
            <Text style={AppText.bodyMedium}>
              추가·삭제·수정 후 저장하면 태그에 기록됩니다.
            </Text>

            <View style={{ height: AppSpacing.lg }} />
            <AppCapacityGauge used={usedBytes} total={totalCapacity} linkCount={links.length} />
            <Text style={AppText.bodyMedium}>링크 {links.length}개 · {linkBytes} B</Text>
            {Platform.OS === 'android' ? <Text style={AppText.bodyMedium}>앱 바로 열기 설정 · {aarBytes} B</Text> : null}

            <View style={{ height: AppSpacing.lg }} />

          {links.length === 0 ? <AppInfoCard title="링크 없음" message="아래 '링크 추가'로 첫 번째 링크를 만들어보세요." variant="neutral" /> : null}
        </>}
        renderRow={(link, index) => {
          const isPrimary = index === 0;
          // 경고는 배지일 뿐 저장을 막지 않는다 (K17). 다른 행이 바뀌면 중복 여부가 달라지므로 매번 계산한다.
          const warnings = warningsForLink(links, index);
          return (
            <View>
              <View style={styles.linkRow}>
                <Pressable style={styles.linkMain} onPress={() => onEditLink(index)}>
                  <Image
                    source={linkTypeIcon(link.linkType.id)}
                    style={styles.linkIcon}
                    resizeMode="contain"
                  />
                  <View style={styles.linkTextCol}>
                    <View style={styles.linkTitleRow}>
                      {/* 기타는 서비스 개념이 없다 — 전부 "직접 입력"으로 보이면 여러 개를 구분할 수 없다 (F6) */}
                      <Text style={styles.linkTitle}>
                        {link.linkType.id === CUSTOM_LINK_TYPE.id ? hostOf(link.normalizedUrl) : link.linkType.label}
                      </Text>
                      {isPrimary ? (
                        <View style={styles.primaryBadge}>
                          <Text style={styles.primaryBadgeText}>대표 · 탭하면 이 링크가 열립니다</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.linkUrl} numberOfLines={1}>
                      {link.normalizedUrl}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.linkActions}>
                  {!isPrimary ? (
                    <Pressable style={styles.actionBtn} onPress={() => onPrimary(index)}>
                      <Text style={styles.actionBtnText}>대표 지정</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.deleteBtn} onPress={() => onRemoveLink(index)}>
                    <Text style={styles.deleteBtnText}>삭제</Text>
                  </Pressable>
                </View>
              </View>
              {warnings.length > 0 ? (
                <View style={{ marginTop: AppSpacing.sm }}>
                  <AppInfoCard {...describeWarnings(warnings)} variant="warning" />
                </View>
              ) : null}
              <View style={{ height: AppSpacing.itemGap }} />
            </View>
          );
        }}
        footer={<>
            <AppSecondaryButton label="링크 추가" onPress={onAddLink} />

            {overCapacity ? (
              <>
                <View style={{ height: 14 }} />
                <AppInfoCard
                  title="용량 초과"
                  message={`태그 용량을 초과했습니다. 링크를 줄여야 저장할 수 있습니다.${aarBytes ? ` 앱 바로 열기 설정을 끄면 ${aarBytes} B가 생깁니다.` : ''}`}
                  variant="error"
                />
              </>
            ) : null}

        </>}
      />

      <View style={styles.footer}>
        <AppPrimaryButton
          label="저장"
          onPress={onSave}
          disabled={!ready || reading || dragging || !!aarNotice || links.length === 0 || cannotSave}
          loading={writing}
        />
      </View>
      <Modal visible={!!aarNotice} transparent animationType="slide" onRequestClose={dismissNotice}
        onShow={() => {
          if (!consent.current) return;
          declineButton.current?.focus();
          const handle = findNodeHandle(declineButton.current);
          if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
        }}>
        <View style={styles.noticeBackdrop}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={styles.noticeSheet} accessibilityViewIsModal>
            <Text style={AppText.titleLarge}>{aarNotice?.primary.linkType.label} 앱으로 바로 열기</Text>
            <Text style={styles.noticeText}>⚠️ {aarNotice?.primary.linkType.label}이 설치되지 않은 기기에서는 프로필 대신 앱 설치 화면이 열립니다. 링크는 열리지 않습니다.</Text>
            <Text style={styles.noticeText}>이 태그를 찍는 안드로이드 기기에서 브라우저를 거치지 않고 {aarNotice?.primary.linkType.label} 앱이 바로 열립니다.</Text>
            <Text style={AppText.bodyMedium}>· 아이폰에서는 이 설정과 무관하게 동작합니다{'\n'}· 태그 용량 {aarNotice?.primary.linkType.androidPackage ? NdefSize.aarBytes(aarNotice.primary.linkType.androidPackage) : 0} B를 사용합니다{'\n'}· 태그를 다시 쓰면 해제됩니다</Text>
            <Pressable ref={declineButton} focusable accessible accessibilityRole="button" accessibilityLabel="켜지 않음"
              style={styles.declineButton} onPress={dismissNotice}>
              <Text style={AppText.titleMedium}>켜지 않음</Text>
            </Pressable>
            <AppSecondaryButton label="켜기" onPress={onAcceptAar} />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  aarPanel: { marginHorizontal: AppSpacing.screenPadding, padding: 14, borderWidth: 1, borderColor: AppColors.border, borderRadius: AppRadius.card },
  aarToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noticeBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000080' },
  noticeSheet: { padding: AppSpacing.screenPadding, paddingBottom: AppSpacing.bottomSafePadding, backgroundColor: AppColors.background },
  noticeText: { ...AppText.bodyMedium, marginVertical: AppSpacing.sm },
  declineButton: { alignItems: 'center', padding: 16, marginVertical: AppSpacing.sm, borderWidth: 1, borderColor: AppColors.borderStrong, borderRadius: AppRadius.button },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 8,
    paddingBottom: 20,
  },
  linkRow: {
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: AppRadius.card,
    padding: 14,
  },
  linkMain: { flexDirection: 'row', alignItems: 'center' },
  linkIcon: { width: 38, height: 38, borderRadius: 9 },
  linkTextCol: { flex: 1, marginLeft: 12 },
  linkTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  linkTitle: { ...AppText.titleMedium },
  primaryBadge: {
    marginLeft: AppSpacing.sm,
    backgroundColor: AppColors.primary,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  primaryBadgeText: { ...AppText.labelSmall, color: '#FFFFFF' },
  linkUrl: {
    ...AppText.bodyMedium,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    marginTop: 3,
  },
  linkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 8,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: AppColors.borderStrong,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionBtnText: { ...AppText.labelSmall, color: AppColors.textPrimary },
  deleteBtn: {
    borderWidth: 1,
    borderColor: AppColors.error,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteBtnText: { ...AppText.labelSmall, color: AppColors.error },
  footer: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingBottom: AppSpacing.bottomSafePadding,
    paddingTop: 8,
  },
});
