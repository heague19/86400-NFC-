import React from 'react';
import { Text, View } from 'react-native';

import { AppInfoCard } from '@/components/AppCards';
import type { NativeNdefRecord } from '@/nfc/aar';
import { preservedRecordDisplay } from '@/utils/preservedRecordDisplay';
import { AppSpacing, AppText } from '@/theme/tokens';

export function PreservedRecords({ records, editing = false }: { records: NativeNdefRecord[]; editing?: boolean }) {
  const items = preservedRecordDisplay(records);
  if (!items.length) return null;
  return (
    <View style={{ marginTop: AppSpacing.lg, marginBottom: editing ? AppSpacing.lg : 0 }}>
      <Text style={AppText.titleMedium}>기존 기록 · 읽기 전용</Text>
      <Text style={AppText.bodyMedium}>
        {editing ? '이 기록은 수정·삭제할 수 없으며, 링크를 저장할 때 그대로 유지됩니다.' : '태그에 저장된 기존 기록입니다.'}
      </Text>
      {items.map((item, index) => (
        <View key={index} style={{ marginTop: AppSpacing.itemGap }}>
          <AppInfoCard title={`${index + 1}. ${item.kind}`} message={`${item.metadata}\n${item.content}`} variant="neutral" />
        </View>
      ))}
    </View>
  );
}
