import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import type { WriterLink } from '@/state/LinkWriterContext';
import { AppColors, AppSpacing, AppText } from '@/theme/tokens';

export function WriteFailureScreen({ message, timedOut = false, links, capacity, onRewrite, onEdit, onDiagnose }: {
  message: string; links: WriterLink[]; capacity: number | undefined;
  timedOut?: boolean;
  onRewrite: () => void; onEdit: () => void; onDiagnose: () => void;
}) {
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={AppText.headlineLarge}>{timedOut ? '시간 초과' : '쓰기를 완료하지 못했습니다'}</Text>
      <Text style={[AppText.bodyLarge, styles.notice]}>{message}</Text>
      <Text style={AppText.bodyMedium}>편집한 링크와 대표는 유지됩니다. 전체 재쓰기는 목록 전체를 처음부터 기록합니다.</Text>
      <Text style={styles.notice}>보존된 링크 {links.length}개 · 읽은 태그 용량 {capacity} B</Text>
      {links.map((link, index) => <View key={link.rowId} style={styles.row}>
        <Text style={AppText.titleMedium}>{index === 0 ? '대표 · ' : ''}{link.linkType.label}</Text>
        <Text style={AppText.bodyMedium}>{link.normalizedUrl}</Text>
      </View>)}
    </ScrollView>
    <View style={styles.footer}>
      <AppPrimaryButton label={timedOut ? '다시 시도' : '전체 재쓰기'} onPress={onRewrite} />
      <View style={{ height: AppSpacing.sm }} />
      <AppSecondaryButton label="편집으로 돌아가기" onPress={onEdit} />
      <View style={{ height: AppSpacing.sm }} />
      {/* §4.9-5 보조 동선 — 태그 자체의 문제인지 가려낸다 */}
      <AppSecondaryButton label="태그 상태 확인" onPress={onDiagnose} />
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
