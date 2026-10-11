// NFC 태그 읽기 화면 — 시안 05_태그연결 구조를 그대로 사용
// 쓰기 화면(UrlPreviewScreen)과 동일한 레이아웃: 제목 / 링 배지 / Saved URL / 버튼
//
// NFC 읽기는 2026-08-25 에 연결됨 (nfcService.ts).
// ⚠️ 에뮬레이터에는 NFC 하드웨어가 없어 "미지원" 분기만 확인 가능 — 실기기 필요.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppCapacityGauge } from '@/components/AppCapacityGauge';
import { AppRingBadge } from '@/components/AppRingBadge';
import { detectLinkTypeFromUrl } from '@/models/linkType';
import { NfcService } from '@/nfc/nfcService';
import { aarLabel, copyNativeRecords, type AarRecord, type NativeNdefRecord } from '@/nfc/aar';
import { NdefSize } from '@/utils/ndefSize';
import { hostOf } from '@/utils/urlNormalizer';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'TagRead'>;

/** 읽어낸 태그 정보 — 수정하기로 넘기기 전까지 이 화면이 들고 있는다 */
interface ReadTag {
  /** 대표 링크 (NDEF 첫 레코드) */
  url: string;
  /** 태그에 들어 있는 전체 링크 */
  urls: string[];
  preservedRecords: NativeNdefRecord[];
  preservationBlocked?: boolean;
  capacity?: number;
  writable?: boolean;
  aarRecords?: AarRecord[];
  usedBytes?: number;
}

export function TagReadScreen({ navigation }: Props) {
  const [reading, setReading] = useState(false);
  const [tag, setTag] = useState<ReadTag | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [nfcAvailable, setNfcAvailable] = useState(true);
  // 읽기 전용·NDEF 아님·상태 조회 실패 — ③ 태그 상태 확인으로 안내할 이상 (D8)
  const [diagnosable, setDiagnosable] = useState(false);
  const readRequest = useRef(0);
  const readPending = useRef(false);
  const readCancellation = useRef<AbortController | null>(null);
  const diagnosing = useRef(false);
  const mounted = useRef(false);
  const initialReadStarted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation.addListener('blur', () => {
      ++readRequest.current;
      readCancellation.current?.abort();
      readCancellation.current = null;
      if (readPending.current) {
        readPending.current = false;
        setReading(false);
      }
    });
    return () => {
      mounted.current = false;
      ++readRequest.current;
      readCancellation.current?.abort();
      readCancellation.current = null;
      readPending.current = false;
      unsubscribe();
    };
  }, [navigation]);

  const onRead = useCallback(async () => {
    if (!mounted.current || readPending.current || !navigation.isFocused()) return;
    const request = ++readRequest.current;
    // 화면을 떠나면 이 요청의 NFC 세션도 취소해야 다른 NFC 화면(③ 등)이 바로 열린다.
    const cancellation = new AbortController();
    readCancellation.current = cancellation;
    readPending.current = true;
    setReading(true);
    setErrorMsg(null);
    setTimedOut(false);
    setDiagnosable(false);
    setTag(null); // 새 읽기가 실패/취소돼도 이전 태그로 수정하기에 진입하지 않는다.
    try {
      const supported = await NfcService.isSupported().catch(() => false);
      if (!mounted.current || request !== readRequest.current || !navigation.isFocused()) return;
      setNfcAvailable(supported);
      if (!supported) return;
      const result = await NfcService.readUrl(cancellation.signal);
      if (!mounted.current || request !== readRequest.current || !navigation.isFocused()) return;
      setTimedOut(result.reason === 'timeout');
      setDiagnosable(result.writable === false || result.reason === 'not_ndef' || result.reason === 'status_unknown' || result.reason === 'invalid_records');
      if ((result.url && (result.ok || result.reason === 'invalid_records')) || (result.reason === 'no_url' && result.urls?.length === 0)) {
        setTag({
          url: result.url ?? '',
          urls: [...(result.urls ?? (result.url ? [result.url] : []))],
          preservedRecords: copyNativeRecords(result.preservedRecords ?? []),
          preservationBlocked: result.reason === 'invalid_records',
          capacity: result.capacity,
          writable: result.writable,
          aarRecords: result.aarRecords,
          usedBytes: result.usedBytes,
        });
        if (!result.ok) setErrorMsg(result.message);
      } else {
        setErrorMsg(result.message);
      }
    } catch {
      if (mounted.current && request === readRequest.current && navigation.isFocused()) {
        setErrorMsg('태그를 읽지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (mounted.current && request === readRequest.current) {
        readPending.current = false;
        readCancellation.current = null;
        setReading(false);
      }
    }
  }, [navigation]);

  useEffect(() => {
    const startInitialRead = () => {
      if (initialReadStarted.current || !navigation.isFocused()) return;
      initialReadStarted.current = true;
      void onRead();
    };
    const unsubscribe = navigation.addListener('focus', startInitialRead);
    startInitialRead();
    return unsubscribe;
  }, [navigation, onRead]);

  /** U6 — 탭하면 브라우저로 열기 */
  const onOpen = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('링크 열기', '링크를 열지 못했습니다. 다시 시도해 주세요.');
    }
  };

  /** U6 — 길게 누르면 URL 복사 */
  const onCopy = async (url: string) => {
    const copied = await Clipboard.setStringAsync(url).catch(() => false);
    Alert.alert(
      copied ? '주소 복사' : '복사 실패',
      copied ? 'URL을 클립보드에 복사했습니다.' : 'URL을 복사하지 못했습니다. 다시 시도해 주세요.',
    );
  };

  /**
   * 이상 안내 → ③ 태그 상태 확인 (D8). 앞선 NFC 세션의 정리가 끝난 뒤에 연다.
   * ③의 나가는 길은 홈뿐이므로 ①을 남기지 않고 [홈, ③]으로 연다.
   */
  const onOpenDiagnosis = async () => {
    if (diagnosing.current || readPending.current || !navigation.isFocused()) return;
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

  const canEdit = !tag?.preservationBlocked && tag?.writable === true && typeof tag.capacity === 'number' &&
    Number.isSafeInteger(tag.capacity) && tag.capacity > 0;

  const onEditTag = () => {
    if (!tag || !canEdit || readPending.current || !navigation.isFocused()) return;
    navigation.navigate('LinkEdit', {
      urls: [...tag.urls],
      preservedRecords: copyNativeRecords(tag.preservedRecords),
      capacity: tag.capacity,
      writable: tag.writable,
    });
  };

  // 읽은 URL의 도메인으로 어디 링크인지 추론 (쓰기 때와 같은 아이콘을 보여주기 위해)
  const linkType = tag?.url ? detectLinkTypeFromUrl(tag.url) : undefined;

  // AAR을 포함한 native 전체 메시지의 사용량만 표시한다.
  const bytes = tag?.usedBytes;
  const total = tag?.capacity;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[AppText.headlineLarge, styles.centerTitle]}>태그의 링크를 읽으세요</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={[AppText.bodyMedium, styles.centerSub]}>
          휴대폰 뒷면을 NFC 키링에 가까이 대세요
        </Text>

        <View style={{ height: AppSpacing.xl }} />
        <AppRingBadge label="NFC" active={reading} pulse />
        <View style={{ height: tag ? AppSpacing.xxl : AppSpacing.xl }} />

        {/* 읽기 전엔 결과 영역을 아예 띄우지 않는다 —
            빈 카드가 자리만 차지하면 "뭔가 있어야 하는데 없다"처럼 보임 */}
        {tag ? (
          <>
            {/* 용량은 태그가 보고한 실측값. 추정하지 않는다 */}
            {bytes !== undefined ? <AppCapacityGauge used={bytes} total={total} linkCount={tag.urls.length} />
              : <Text style={AppText.bodyMedium}>사용량 확인 불가 · 전체 용량 {total === undefined ? '확인 불가' : `${total} B`}</Text>}

            <View style={{ height: AppSpacing.lg }} />

            {tag.urls.map((u, i) => {
              const t = detectLinkTypeFromUrl(u);
              const size = NdefSize.estimateUrlRecordBytes(u);
              return (
                <View key={`${u}-${i}`}>
                  <Pressable
                    onPress={() => onOpen(u)}
                    onLongPress={() => onCopy(u)}
                    style={({ pressed }) => [styles.linkCard, pressed && styles.linkCardPressed]}
                  >
                    <Image
                      source={linkTypeIcon(t?.id ?? 'custom')}
                      style={styles.linkIcon}
                      resizeMode="contain"
                    />
                    <View style={styles.linkTextCol}>
                      <View style={styles.linkTitleRow}>
                        <Text style={styles.linkTitle}>{t?.label ?? hostOf(u)}</Text>
                        {i === 0 ? (
                          <View style={styles.primaryBadge}>
                            <Text style={styles.primaryBadgeText}>탭하면 이 링크가 열립니다</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.linkUrl} numberOfLines={1}>
                        {u}
                      </Text>
                    </View>
                    <Text style={styles.linkSize}>{size} B</Text>
                  </Pressable>
                  {i < tag.urls.length - 1 ? (
                    <View style={{ height: AppSpacing.itemGap }} />
                  ) : null}
                </View>
              );
            })}

            <View style={{ height: AppSpacing.sm }} />
            <Text style={styles.hint}>탭하면 링크 열기 · 길게 누르면 주소 복사</Text>
            {tag.aarRecords?.map((record, index) => (
              <View key={index} style={[styles.linkCard, styles.aarCard]}>
                <Text style={styles.linkTitle}>앱 바로 열기 레코드</Text>
                <Text style={styles.linkUrl}>{aarLabel(record)}</Text>
                <Text style={styles.linkSize}>태그에 저장됨</Text>
              </View>
            ))}
            {tag.writable === false ? (
              <>
                <View style={{ height: AppSpacing.lg }} />
                <AppInfoCard
                  title="읽기 전용 태그"
                  message="이 태그는 잠겨 있어 수정할 수 없습니다. 태그 상태 확인에서 자세한 상태를 볼 수 있습니다."
                  variant="warning"
                />
              </>
            ) : null}
          </>
        ) : null}

        {!nfcAvailable ? (
          <>
            <View style={{ height: 14 }} />
            <AppInfoCard
              title="NFC 미지원"
              message="이 기기는 NFC를 지원하지 않아 태그를 읽을 수 없습니다."
              variant="warning"
            />
          </>
        ) : null}

        {errorMsg ? (
          <>
            <View style={{ height: 14 }} />
            <AppInfoCard title={timedOut ? '시간 초과' : '읽기 실패'} message={errorMsg} variant="error" />
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {tag ? (
          // 읽은 뒤 — 확인하고 넘어가거나 다시 읽거나
          <>
            <AppPrimaryButton label="수정하기" onPress={onEditTag} disabled={!canEdit} />
            {diagnosable ? (
              <>
                <View style={{ height: AppSpacing.itemGap }} />
                <AppSecondaryButton label="태그 상태 확인" onPress={onOpenDiagnosis} />
              </>
            ) : null}
            <View style={{ height: AppSpacing.itemGap }} />
            <AppSecondaryButton label="다시 읽기" onPress={onRead} />
          </>
        ) : (
          <>
            <AppPrimaryButton
              label={reading ? '태그를 대세요…' : timedOut ? '다시 시도' : '태그 읽기'}
              onPress={onRead}
              disabled={!nfcAvailable}
              loading={reading}
            />
            {diagnosable ? (
              <>
                <View style={{ height: AppSpacing.itemGap }} />
                <AppSecondaryButton label="태그 상태 확인" onPress={onOpenDiagnosis} />
              </>
            ) : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  centerTitle: { textAlign: 'center' },
  centerSub: { textAlign: 'center', color: AppColors.textPrimary, opacity: AppOpacity.secondary },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 8,
    paddingBottom: 20,
  },
  urlCard: {
    backgroundColor: AppColors.cardBackground,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: AppRadius.card,
    height: 63,
    justifyContent: 'center',
    paddingHorizontal: 19,
  },
  typeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  typeIcon: { width: 44, height: 44, borderRadius: 10 },
  typeLabel: { ...AppText.titleLarge, marginLeft: AppSpacing.itemGap },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: AppRadius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  linkCardPressed: { backgroundColor: AppColors.backgroundSubtle },
  aarCard: { flexDirection: 'column', alignItems: 'flex-start', marginTop: AppSpacing.itemGap },
  linkIcon: { width: 38, height: 38, borderRadius: 9 },
  linkTextCol: { flex: 1, marginLeft: 12, marginRight: AppSpacing.sm },
  linkTitleRow: { flexDirection: 'column', alignItems: 'flex-start' },
  linkTitle: { ...AppText.titleMedium },
  primaryBadge: {
    marginTop: AppSpacing.xs,
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
  linkSize: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.tertiary,
  },
  hint: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.tertiary,
    textAlign: 'center',
  },
  urlLabel: { ...AppText.titleMedium, textAlign: 'center' },
  url: { ...AppText.bodyLarge, textAlign: 'center' },
  urlEmpty: { opacity: AppOpacity.tertiary },
  usageLabel: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.tertiary,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingBottom: AppSpacing.bottomSafePadding,
    paddingTop: 8,
  },
});
