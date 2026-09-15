// 태그 용량 게이지 — 시안(135 / 141 B · 링크 N개 · 여유 M B) 이식
//
// 분모(capacity)는 추정하지 않는다. 태그가 getNdefStatus()로 보고한 실측값만 쓴다.
// 태그가 값을 안 주는 경우에만 NTAG213 기본값으로 폴백한다.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';

interface Props {
  /** 실제 쓰인 바이트 */
  used: number;
  /** 태그가 보고한 전체 용량 */
  total: number;
  /** 태그에 들어 있는 링크 개수 */
  linkCount: number;
}

export function AppCapacityGauge({ used, total, linkCount }: Props) {
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(used / safeTotal, 1);
  const remain = Math.max(total - used, 0);

  // 여유가 거의 없으면 색으로 먼저 알린다 (수치를 읽기 전에 보이도록)
  const tight = remain <= 10;
  const over = used > total;
  const barColor = over ? AppColors.error : AppColors.primary;

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.numberRow}>
          <Text style={styles.used}>{used}</Text>
          <Text style={styles.total}> / {total} B</Text>
        </View>

        <View style={[styles.badge, (tight || over) && styles.badgeWarn]}>
          <Text style={[styles.badgeText, (tight || over) && styles.badgeTextWarn]}>
            링크 {linkCount}개 · 여유 {remain} B
          </Text>
        </View>
      </View>

      <View style={{ height: AppSpacing.itemGap }} />

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%`, backgroundColor: barColor },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  numberRow: { flexDirection: 'row', alignItems: 'baseline' },
  used: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    color: AppColors.textPrimary,
  },
  total: {
    ...AppText.bodyMedium,
    color: AppColors.textPrimary,
    opacity: AppOpacity.tertiary,
  },
  badge: {
    backgroundColor: AppColors.backgroundSubtle,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeWarn: { backgroundColor: AppColors.errorBackground },
  badgeText: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
  },
  badgeTextWarn: { color: AppColors.error, opacity: 1 },
  track: {
    height: 26,
    borderRadius: 6,
    backgroundColor: AppColors.backgroundSubtle,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 6 },
});
