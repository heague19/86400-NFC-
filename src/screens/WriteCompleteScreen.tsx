// 쓰기 완료 화면 — 시안 07_완료
// 체크 아이콘 + 완료 문구 + Saved URL + Verify / Next 버튼

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { APP_ICONS } from '@/theme/icons';
import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'WriteComplete'>;

export function WriteCompleteScreen({ route, navigation }: Props) {
  const { urls, linkTypeId } = route.params;
  const primaryUrl = urls[0];
  const { clear } = useLinkWriter();

  const onVerify = () => {
    // 방금 쓴 태그를 다시 읽어 확인하는 흐름 — 대표 링크 기준으로 보여준다
    navigation.navigate('TagInfo', { url: primaryUrl, linkTypeId, writable: true });
  };

  const onNext = () => {
    // HANDOFF.md §4.8 "다른 태그도 쓰기" — 여기서는 완전한 새 태그이므로
    // 기존 목록을 비우고 처음부터 다시 시작한다.
    clear();
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ height: AppSpacing.xl }} />
        <Image source={APP_ICONS.check} style={styles.check} resizeMode="contain" />

        <View style={{ height: AppSpacing.lg }} />
        <Text style={[AppText.headlineLarge, styles.centerTitle]}>쓰기 완료</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={[AppText.bodyMedium, styles.centerSub]}>
          NFC 태그에 링크 {urls.length}개가 저장되었습니다
        </Text>

        <View style={{ height: AppSpacing.xxl }} />
        <Text style={styles.urlLabel}>대표 링크</Text>
        <View style={{ height: AppSpacing.sm }} />
        <View style={styles.urlCard}>
          <Text style={styles.url} numberOfLines={1} selectable>
            {primaryUrl}
          </Text>
        </View>

        {urls.length > 1 ? (
          <>
            <View style={{ height: AppSpacing.sm }} />
            <Text style={styles.subCount}>외 {urls.length - 1}개 링크 함께 저장됨</Text>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <AppPrimaryButton label="확인" onPress={onVerify} />
        <View style={{ height: AppSpacing.itemGap }} />
        <AppSecondaryButton label="다른 태그도 쓰기" onPress={onNext} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 8,
    paddingBottom: 20,
  },
  centerTitle: { textAlign: 'center' },
  centerSub: { textAlign: 'center', color: AppColors.textPrimary, opacity: AppOpacity.secondary },
  check: { width: 65, height: 65, alignSelf: 'center' },
  urlLabel: { ...AppText.titleMedium, textAlign: 'center' },
  urlCard: {
    backgroundColor: AppColors.cardBackground,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: AppRadius.card,
    height: 63,
    justifyContent: 'center',
    paddingHorizontal: 19,
  },
  url: { ...AppText.bodyLarge, textAlign: 'center' },
  subCount: {
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
