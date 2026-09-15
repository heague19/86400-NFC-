// 태그 확인 화면 — 시안 08_태그확인 / 08_태그확인_2
// 읽어온 태그의 URL·정보 표시 + 동작(열기/다시쓰기/복사)
//
// TagRead 에서 읽어낸 실제 태그 값(URL·용량·쓰기가능)을 받아 표시한다.
// capacity 가 없으면 NTAG213 기본값(144byte)으로 폴백.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { detectLinkTypeFromUrl, findLinkTypeById } from '@/models/linkType';
import { NdefSize } from '@/utils/ndefSize';
import { APP_LOGO, linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'TagInfo'>;

/** 좌우 2열로 놓이는 정보 항목 (시안 Group 590~593) */
function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/** 하단 동작 목록 (시안: OPEN URL / REWRITE / COPY) */
function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.actionPressed]}>
      <Text style={styles.action}>{label}</Text>
    </Pressable>
  );
}

export function TagInfoScreen({ route, navigation }: Props) {
  const { url, linkTypeId, writable, capacity } = route.params;
  // 쓰기 흐름: linkTypeId 를 그대로 받음
  // 읽기 흐름: linkTypeId 가 없으므로 URL 도메인으로 추론
  const linkType = (linkTypeId ? findLinkTypeById(linkTypeId) : undefined)
    ?? detectLinkTypeFromUrl(url);

  const used = NdefSize.estimateUrlRecordBytes(url);
  // 실기기에서 태그가 알려준 실제 용량을 우선 사용 (없으면 NTAG213 기본값)
  const total = capacity ?? NdefSize.maxBytes;
  const percent = Math.round(Math.min(used / total, 1) * 100);

  const onOpenUrl = async () => {
    const ok = await Linking.canOpenURL(url);
    if (ok) {
      Linking.openURL(url);
    } else {
      Alert.alert('링크 열기', '이 링크를 열 수 있는 앱이 없습니다.');
    }
  };

  const onRewrite = () => {
    navigation.navigate('LinkTypeSelect');
  };

  const onCopy = () => {
    // expo-clipboard 미설치 상태 — 설치 후 연결 예정
    Alert.alert('복사', 'URL 복사 기능은 다음 단계에서 연결됩니다.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 시안 Frame 786: 로고(좌) ∞ 아이콘(우) */}
        <View style={styles.brandRow}>
          <Image source={APP_LOGO.black} style={styles.logo} resizeMode="contain" />
          {linkType ? (
            <>
              <Text style={styles.linkMark}>∞</Text>
              <Image source={linkTypeIcon(linkType.id)} style={styles.typeIcon} resizeMode="contain" />
            </>
          ) : null}
        </View>

        <View style={{ height: AppSpacing.lg }} />
        <Text style={styles.title}>Read NFC Tag</Text>
        <View style={{ height: AppSpacing.xs }} />
        <Text style={styles.subtitle}>Check your information</Text>

        <View style={{ height: AppSpacing.xl }} />
        <Text style={styles.sectionLabel}>Saved URL</Text>
        <Text style={styles.url} numberOfLines={3} selectable>
          {url}
        </Text>

        <View style={{ height: AppSpacing.xl }} />
        <View style={styles.infoGrid}>
          <InfoItem label="Tag Type" value={linkType?.label ?? '링크'} />
          <InfoItem label="Max Storage" value={`${total} byte`} />
        </View>
        <View style={{ height: AppSpacing.lg }} />
        <View style={styles.infoGrid}>
          <InfoItem label="Write Ability" value={writable ? 'True' : 'False'} />
          <InfoItem label="Used Storage" value={`${used} byte (${percent}%)`} />
        </View>

        <View style={{ height: AppSpacing.xxl }} />
        <ActionRow label="OPEN URL" onPress={onOpenUrl} />
        <ActionRow label="REWRITE" onPress={onRewrite} />
        <ActionRow label="COPY" onPress={onCopy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: {
    // 시안 left 48 / 화면폭 393 ≈ 12.2%
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 24,
    paddingBottom: AppSpacing.bottomSafePadding,
  },
  // 시안: 로고 left 66 / 아이콘 left 243 → 사이를 ∞ 로 채움
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  logo: { width: 88, height: 50 },
  linkMark: {
    fontSize: 26,
    color: AppColors.textPrimary,
    // 로고와 아이콘을 '엮는' 장식이므로 양쪽 로고보다 뒤로 물린다
    opacity: AppOpacity.decorative,
    marginHorizontal: 22,
  },
  typeIcon: { width: 65, height: 65, borderRadius: 14 },

  // 시안: 제목 left 97 (본문 48 기준 +49), 부제 left 135
  title: { ...AppText.displaySmall, textAlign: 'center' },
  subtitle: {
    ...AppText.bodyMedium,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    textAlign: 'center',
  },

  sectionLabel: { ...AppText.titleMedium, textAlign: 'center' },
  url: {
    ...AppText.bodyMedium,
    color: AppColors.link,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: AppSpacing.xs,
  },

  // 시안: 좌 48px / 우 209px  (본문폭 345 기준 우측이 약 47%)
  infoGrid: { flexDirection: 'row' },
  infoItem: { flex: 1 },
  // 라벨은 보조, 값이 주정보 — 기존엔 라벨 20 / 값 12 로 위계가 뒤집혀 있었음
  infoLabel: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
  },
  infoValue: { ...AppText.titleMedium, marginTop: AppSpacing.xs },

  action: {
    ...AppText.titleMedium,
    textAlign: 'center',
    paddingVertical: AppSpacing.itemGap,
  },
  actionPressed: { opacity: AppOpacity.pressed },
});
