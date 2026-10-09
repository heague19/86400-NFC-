// 홈 화면 — Flutter home_screen.dart 이식본

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppActionCard } from '@/components/AppCards';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { APP_ICONS, APP_LOGO } from '@/theme/icons';
import { AppColors, AppOpacity, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { disableAar } = useLinkWriter();
  useEffect(() => {
    if (navigation.isFocused()) disableAar();
    return navigation.addListener('focus', disableAar);
  }, [navigation, disableAar]);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Image source={APP_LOGO.black} style={styles.logo} resizeMode="contain" />

        <View style={{ height: AppSpacing.lg }} />
        <Text style={AppText.headlineLarge}>86400</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={AppText.titleLarge}>NFC 태그에 원하는 링크를 저장하세요</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={[AppText.bodyMedium, styles.lead]}>
          Instagram, GitHub, LinkedIn 등 다양한 링크를 NFC 태그에 담아보세요.
        </Text>

        <View style={{ height: AppSpacing.sectionGap }} />
        <View style={styles.hero}>
          <Image source={APP_ICONS.nfc} style={styles.heroIcon} resizeMode="contain" />
          <Text style={styles.heroTitle}>오프라인에서 나를 한 번에</Text>
          <Text style={styles.heroDesc}>
            키링을 태그하면 내 링크가 상대 폰에 바로 열립니다.
          </Text>
        </View>

        <View style={{ height: AppSpacing.sectionGap }} />
        <AppActionCard
          icon={APP_ICONS.nfc}
          title="링크 보기"
          description="태그에 담긴 링크를 확인합니다."
          onPress={() => navigation.navigate('TagRead')}
        />
        <View style={{ height: AppSpacing.itemGap }} />
        <AppActionCard
          icon={APP_ICONS.edit}
          title="링크 편집"
          description="태그에 담을 링크를 편집합니다."
          onPress={() => navigation.navigate('LinkEdit')}
        />
        <View style={{ height: AppSpacing.itemGap }} />
        {/* 화면 이동만 한다 — 홈에서는 NFC 세션을 열지 않는다 (§4.1). 읽기는 ③이 스스로 시작한다. */}
        <AppActionCard
          icon={APP_ICONS.shield}
          title="태그 상태 확인"
          description="태그의 상태와 용량을 확인합니다."
          onPress={() => navigation.navigate('TagInfo')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 36,
    paddingBottom: AppSpacing.bottomSafePadding,
  },
  logo: { width: 46, height: 26 },
  hero: {
    backgroundColor: AppColors.primary,
    borderRadius: 12,
    padding: 22,
  },
  heroIcon: { width: 44, height: 44, marginBottom: 12, borderRadius: 12 },
  heroTitle: { ...AppText.titleLarge, color: '#FFFFFF' },
  heroDesc: {
    ...AppText.bodyMedium,
    color: '#FFFFFF',
    opacity: AppOpacity.secondary,
    marginTop: AppSpacing.xs,
  },
  lead: { color: AppColors.textPrimary, opacity: AppOpacity.secondary },
});
