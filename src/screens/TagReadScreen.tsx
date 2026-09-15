// NFC 태그 읽기 화면 — 시안 05_태그연결 구조를 그대로 사용
// 쓰기 화면(UrlPreviewScreen)과 동일한 레이아웃: 제목 / 링 배지 / Saved URL / 버튼
//
// NFC 읽기는 2026-08-25 에 연결됨 (nfcService.ts).
// ⚠️ 에뮬레이터에는 NFC 하드웨어가 없어 "미지원" 분기만 확인 가능 — 실기기 필요.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppCapacityGauge } from '@/components/AppCapacityGauge';
import { AppRingBadge } from '@/components/AppRingBadge';
import { detectLinkTypeFromUrl } from '@/models/linkType';
import { NfcService } from '@/nfc/nfcService';
import { NdefSize } from '@/utils/ndefSize';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'TagRead'>;

/** 읽어낸 태그 정보 — 상세화면으로 넘기기 전까지 이 화면이 들고 있는다 */
interface ReadTag {
  /** 대표 링크 (NDEF 첫 레코드) */
  url: string;
  /** 태그에 들어 있는 전체 링크 */
  urls: string[];
  capacity?: number;
  writable?: boolean;
}

/** 프리셋에 없는 링크는 도메인을 라벨로 쓴다 (notion.so, velog.io) */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '링크';
  }
}

export function TagReadScreen({ navigation }: Props) {
  const [reading, setReading] = useState(false);
  const [tag, setTag] = useState<ReadTag | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nfcAvailable, setNfcAvailable] = useState(true);

  // 진입 시 NFC 지원 여부 확인
  useEffect(() => {
    let alive = true;
    NfcService.isSupported().then((ok) => {
      if (alive) setNfcAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onRead = async () => {
    setReading(true);
    setErrorMsg(null);
    const result = await NfcService.readUrl();
    setReading(false);

    if (result.ok && result.url) {
      // 바로 넘기지 않고 이 화면에 결과를 보여준다.
      // 사용자가 읽힌 걸 확인한 뒤 직접 다음으로 넘어가게 함.
      setTag({
        url: result.url,
        urls: result.urls?.length ? result.urls : [result.url],
        capacity: result.capacity,
        writable: result.writable,
      });
    } else if (result.reason === 'cancelled') {
      // 사용자가 스스로 취소한 것 — 에러도 안 띄우고, 이미 읽어둔 결과도 지우지 않는다.
      // (다시 읽기를 눌렀다가 취소했는데 기존 결과가 사라지면 당황스러움)
    } else {
      setTag(null);
      setErrorMsg(result.message);
    }
  };

  /** U6 — 탭하면 브라우저로 열기 */
  const onOpen = async (url: string) => {
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (ok) {
      Linking.openURL(url).catch(() => {});
    } else {
      Alert.alert('링크 열기', '이 링크를 열 수 있는 앱이 없습니다.');
    }
  };

  /** U6 — 길게 누르면 URL 복사 (expo-clipboard 미설치 상태) */
  const onCopy = (url: string) => {
    Alert.alert('주소 복사', url);
  };

  /** 확인 후 상세 화면으로 — 태그가 알려준 실제 값을 넘긴다 */
  const onOpenDetail = () => {
    if (!tag) return;
    navigation.navigate('TagInfo', {
      url: tag.url,
      writable: tag.writable ?? false,
      capacity: tag.capacity,
    });
  };

  // 읽은 URL의 도메인으로 어디 링크인지 추론 (쓰기 때와 같은 아이콘을 보여주기 위해)
  const linkType = tag ? detectLinkTypeFromUrl(tag.url) : undefined;

  // 게이지는 태그에 실제로 들어 있는 전체 링크를 합산한다
  const bytes = tag
    ? tag.urls.reduce((sum, u) => sum + NdefSize.estimateUrlRecordBytes(u), 0)
    : 0;
  // 태그가 알려준 실제 용량 우선 (없으면 NTAG213 기본값)
  const total = tag?.capacity ?? NdefSize.maxBytes;

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
            <AppCapacityGauge used={bytes} total={total} linkCount={tag.urls.length} />

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
                            <Text style={styles.primaryBadgeText}>대표</Text>
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
            <AppInfoCard title="읽기 실패" message={errorMsg} variant="error" />
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {tag ? (
          // 읽은 뒤 — 확인하고 넘어가거나 다시 읽거나
          <>
            <AppPrimaryButton label="상세 정보 보기" onPress={onOpenDetail} />
            <View style={{ height: AppSpacing.itemGap }} />
            <AppSecondaryButton label="다시 읽기" onPress={onRead} />
          </>
        ) : (
          <AppPrimaryButton
            label={reading ? '태그를 대세요…' : '태그 읽기'}
            onPress={onRead}
            disabled={!nfcAvailable}
            loading={reading}
          />
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
  linkIcon: { width: 38, height: 38, borderRadius: 9 },
  linkTextCol: { flex: 1, marginLeft: 12, marginRight: AppSpacing.sm },
  linkTitleRow: { flexDirection: 'row', alignItems: 'center' },
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
