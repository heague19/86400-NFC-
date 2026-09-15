// ActionCard / InfoCard — Flutter app_action_card / app_info_card 이식본

import React from 'react';
import { Image, ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppColors, AppOpacity, AppRadius, AppSizes, AppSpacing, AppText, cardShadow } from '@/theme/tokens';

interface ActionCardProps {
  title: string;
  description: string;
  /**
   * 아이콘 이미지 (시안 기준).
   * 에셋에 라운드 배경이 이미 포함돼 있으므로 별도 배경 박스를 씌우지 않는다.
   */
  icon?: ImageSourcePropType;
  emoji?: string;
  /** icon 없이 emoji 를 쓸 때만 사용하는 배경색 */
  iconBackgroundColor?: string;
  onPress: () => void;
}

export function AppActionCard({
  title,
  description,
  icon,
  emoji = '🔗',
  iconBackgroundColor = AppColors.primary,
  onPress,
}: ActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        cardShadow,
        { backgroundColor: pressed ? AppColors.backgroundSubtle : AppColors.cardBackground },
      ]}
    >
      <View style={styles.row}>
        {icon ? (
          <Image source={icon} style={styles.iconImage} resizeMode="contain" />
        ) : (
          <View style={[styles.iconBox, { backgroundColor: iconBackgroundColor }]}>
            <Text style={styles.iconEmoji}>{emoji}</Text>
          </View>
        )}
        <View style={styles.textCol}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.desc}>{description}</Text>
        </View>
        <View style={styles.chevronBox}>
          <Text style={styles.chevron}>›</Text>
        </View>
      </View>
    </Pressable>
  );
}

type InfoVariant = 'neutral' | 'success' | 'error' | 'warning';

interface InfoCardProps {
  title?: string;
  message: string;
  variant?: InfoVariant;
}

const VARIANT_STYLE: Record<InfoVariant, { bg: string; fg: string }> = {
  neutral: { bg: AppColors.backgroundSubtle, fg: AppColors.textSecondary },
  success: { bg: AppColors.successBackground, fg: AppColors.success },
  error: { bg: AppColors.errorBackground, fg: AppColors.error },
  warning: { bg: AppColors.warningBackground, fg: AppColors.warning },
};

export function AppInfoCard({ title, message, variant = 'neutral' }: InfoCardProps) {
  const v = VARIANT_STYLE[variant];
  return (
    <View style={[styles.infoCard, { backgroundColor: v.bg }]}>
      {title ? <Text style={[styles.infoTitle, { color: v.fg }]}>{title}</Text> : null}
      <Text style={[styles.infoMsg, { color: variant === 'neutral' ? AppColors.textSecondary : v.fg }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: AppRadius.card,
    paddingHorizontal: 17,
    minHeight: AppSizes.cardHeight,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: AppSizes.cardIcon,
    height: AppSizes.cardIcon,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: { fontSize: 22 },
  iconImage: { width: AppSizes.cardIcon, height: AppSizes.cardIcon, borderRadius: 12 },
  textCol: { flex: 1, marginLeft: 15, marginRight: AppSpacing.sm },
  // 제목/설명 위계 강화 — 16/13 은 대비가 약해 같은 무게로 읽혔음
  title: { ...AppText.titleLarge },
  desc: {
    ...AppText.bodyMedium,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    marginTop: 6,
  },
  // 글리프 세로 중앙 정렬 — lineHeight 를 박스 높이와 맞춰 baseline 쏠림 제거
  chevronBox: { width: 20, alignItems: 'center', justifyContent: 'center' },
  chevron: {
    fontSize: 26,
    lineHeight: 30,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    includeFontPadding: false,
  },
  infoCard: {
    borderRadius: AppRadius.input,
    padding: 14,
  },
  infoTitle: { ...AppText.labelSmall, marginBottom: 4 },
  infoMsg: { ...AppText.bodyMedium },
});
