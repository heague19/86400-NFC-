import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import type { WriterLink } from '@/state/LinkWriterContext';
import { AppColors, AppSpacing, AppText } from '@/theme/tokens';

export function WriteFailureScreen({ message, links, capacity, onRewrite, onEdit }: {
  message: string; links: WriterLink[]; capacity: number | undefined; onRewrite: () => void; onEdit: () => void;
}) {
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={AppText.headlineLarge}>쓰기를 완료하지 못했습니다</Text>
      <Text style={[AppText.bodyLarge, styles.notice]}>{message}</Text>
      <Text style={AppText.bodyMedium}>편집한 링크와 대표는 유지됩니다. 전체 재쓰기는 목록 전체를 처음부터 기록합니다.</Text>
      <Text style={styles.notice}>보존된 링크 {links.length}개 · 읽은 태그 용량 {capacity} B</Text>
      {links.map((link, index) => <View key={link.rowId} style={styles.row}>
        <Text style={AppText.titleMedium}>{index === 0 ? '대표 · ' : ''}{link.linkType.label}</Text>
        <Text style={AppText.bodyMedium}>{link.normalizedUrl}</Text>
      </View>)}
    </ScrollView>
    <View style={styles.footer}>
      <AppPrimaryButton label="전체 재쓰기" onPress={onRewrite} />
      <View style={{ height: AppSpacing.sm }} />
      <AppSecondaryButton label="편집으로 돌아가기" onPress={onEdit} />
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: { padding: AppSpacing.screenPadding },
  notice: { ...AppText.bodyMedium, marginVertical: AppSpacing.lg },
  row: { paddingVertical: AppSpacing.sm },
  footer: { padding: AppSpacing.screenPadding },
});
