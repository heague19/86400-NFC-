// 검증 성공 후의 완료 화면 — HANDOFF §4.8

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { aarLabel } from '@/nfc/aar';
import { APP_ICONS } from '@/theme/icons';
import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'WriteComplete'>;

export function WriteCompleteScreen({ route, navigation }: Props) {
  const { urls, usedBytes, androidPackage } = route.params;
  const primaryUrl = urls[0];
  const onDone = () => {
    if (!navigation.isFocused()) return;
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const onNext = () => {
    if (!navigation.isFocused()) return;
    // 원래 LinkEdit는 스택에 남긴다. 입력 완료의 popTo가 그 편집으로 돌아간다.
    navigation.replace('LinkTypeSelect');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ height: AppSpacing.xl }} />
        <Image source={APP_ICONS.check} style={styles.check} resizeMode="contain" />

        <View style={{ height: AppSpacing.lg }} />
        <Text style={[AppText.headlineLarge, styles.centerTitle]}>쓰기 완료</Text>
        <Text style={[AppText.bodyMedium, styles.centerSub]}>✓ 쓰기 → ✓ 검증 재읽기 → ✓ 완료</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={[AppText.bodyMedium, styles.centerSub]}>
          링크 {urls.length}개 저장 · 최종 사용량 {usedBytes} B
        </Text>
        {androidPackage ? <Text style={[AppText.bodyMedium, styles.centerSub]}>
          안드로이드에서 {aarLabel({ packageName: androidPackage })} 앱으로 바로 열립니다
        </Text> : null}

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
        <AppPrimaryButton label="완료" onPress={onDone} />
        <View style={{ height: AppSpacing.itemGap }} />
        <AppSecondaryButton label="링크 더 추가하기" onPress={onNext} />
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
