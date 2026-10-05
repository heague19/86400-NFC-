import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppSecondaryButton } from '@/components/AppButton';
import type { NfcWriteStage } from '@/nfc/nfcService';
import { AppColors, AppSpacing, AppText } from '@/theme/tokens';

export function WriteWaitingScreen({ stage, onCancel }: { stage: NfcWriteStage; onCancel: () => void }) {
  const step = stage === 'verifying' ? 1 : 0;
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <View style={styles.content}>
      <Text style={AppText.headlineLarge}>{stage === 'waiting' ? '태그를 대세요' : stage === 'writing' ? '링크를 쓰는 중입니다' : '검증 재읽기 중입니다'}</Text>
      <Text style={[AppText.bodyLarge, styles.notice]}>완료될 때까지 태그를 떼지 마세요.</Text>
      {['쓰기', '검증 재읽기', '완료'].map((label, index) => <Text key={label}
        style={[AppText.titleMedium, styles.step, { opacity: index <= step ? 1 : 0.4 }]}>
        {index < step ? '✓' : index === step ? '●' : '○'} {index + 1}. {label}
      </Text>)}
    </View>
    <View style={styles.footer}><AppSecondaryButton label="취소" onPress={onCancel} /></View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: { flex: 1, padding: AppSpacing.screenPadding },
  notice: { marginVertical: AppSpacing.lg },
  step: { marginVertical: AppSpacing.sm },
  footer: { padding: AppSpacing.screenPadding },
});
