// ③ 태그 상태 확인 — HANDOFF.md §4.10
// 진단 전용 페이지: 홈에서 곧바로 들어와 스스로 태그를 한 번 읽는다 (파라미터 없음).
// 쓰기·잠금·포맷 실행·수정 버튼이 없고 나가는 길은 홈뿐이다.
// 값은 태그가 알려준 것만 표시한다 — 모르면 "확인 불가"이며 상수로 채우지 않는다.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppCapacityGauge } from '@/components/AppCapacityGauge';
import { AppRingBadge } from '@/components/AppRingBadge';
import { NfcService, type NfcInspectResult, type NfcTagState } from '@/nfc/nfcService';
import { aarLabel } from '@/nfc/aar';
import { AppColors, AppOpacity, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'TagInfo'>;

/** HANDOFF §4.10 — NdefStatus 3상태 화면 */
const STATE_TITLE: Record<NfcTagState, string> = {
  read_write: '정상',
  read_only: '이 태그는 잠겨 있습니다',
  not_ndef: 'NDEF 태그가 아닙니다',
};
const STATE_DESC: Record<NfcTagState, string> = {
  read_write: '읽기와 쓰기가 가능한 NDEF 태그입니다.',
  read_only: '읽기만 가능합니다. 이 태그에는 저장할 수 없습니다.',
  not_ndef: '링크를 읽거나 저장할 수 없는 태그입니다. 다른 태그를 사용하세요.',
};

const bytes = (value: number | undefined) => (value === undefined ? '확인 불가' : `${value} B`);

/** 좌우 2열로 놓이는 정보 항목 */
function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function TagInfoScreen({ navigation }: Props) {
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<NfcInspectResult | null>(null);
  const request = useRef(0);
  const pending = useRef(false);
  const cancellation = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const onInspect = useCallback(async () => {
    if (pending.current || !navigation.isFocused()) return;
    const id = ++request.current;
    const abort = new AbortController();
    cancellation.current = abort;
    pending.current = true;
    setReading(true);
    setResult(null); // 새 확인이 실패/취소돼도 이전 태그의 진단을 남기지 않는다.
    try {
      const next = await NfcService.inspectTag(abort.signal);
      if (!mounted.current || id !== request.current || !navigation.isFocused()) return;
      setResult(next);
    } catch {
      if (mounted.current && id === request.current && navigation.isFocused()) {
        setResult({ ok: false, reason: 'failed', message: '태그를 확인하지 못했습니다. 다시 시도해주세요.' });
      }
    } finally {
      if (mounted.current && id === request.current) {
        pending.current = false;
        cancellation.current = null;
        setReading(false);
      }
    }
  }, [navigation]);

  // 진입하면 곧바로 한 번 읽는다. 다시 읽기는 사용자가 누를 때만 — 자동 재시도 없음.
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation.addListener('blur', () => {
      ++request.current;
      cancellation.current?.abort();
      cancellation.current = null;
      if (pending.current) {
        pending.current = false;
        setReading(false);
        setResult({ ok: false, reason: 'cancelled', message: '태그 확인이 중단되었습니다. 다시 확인해주세요.' });
      }
    });
    void onInspect();
    return () => {
      mounted.current = false;
      ++request.current;
      cancellation.current?.abort();
      cancellation.current = null;
      pending.current = false;
      unsubscribe();
    };
  }, [navigation, onInspect]);

  const onHome = () => {
    if (!navigation.isFocused()) return;
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const ok = result?.ok ? result : null;
  const remaining = ok?.capacity !== undefined && ok.usedBytes !== undefined
    ? Math.max(ok.capacity - ok.usedBytes, 0)
    : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[AppText.headlineLarge, styles.center]}>태그 상태 확인</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={[AppText.bodyMedium, styles.subtitle]}>
          {reading ? '휴대폰 뒷면을 태그에 가까이 대세요' : '태그의 상태만 확인합니다. 태그는 변경되지 않습니다.'}
        </Text>

        <View style={{ height: AppSpacing.xl }} />
        <AppRingBadge label="NFC" active={reading} pulse />
        <View style={{ height: AppSpacing.xl }} />

        {ok ? (
          <>
            <Text style={[AppText.titleLarge, styles.center]}>{STATE_TITLE[ok.state]}</Text>
            <View style={{ height: AppSpacing.xs }} />
            <Text style={[AppText.bodyMedium, styles.subtitle]}>{STATE_DESC[ok.state]}</Text>

            {ok.state === 'not_ndef' ? (
              <>
                <View style={{ height: AppSpacing.xl }} />
                <InfoItem label="NDEF 포맷" value="아님" />
              </>
            ) : (
              <>
                <View style={{ height: AppSpacing.xl }} />
                {ok.capacity !== undefined && ok.usedBytes !== undefined ? (
                  <>
                    <AppCapacityGauge used={ok.usedBytes} total={ok.capacity} />
                    <View style={{ height: AppSpacing.lg }} />
                  </>
                ) : null}
                <View style={styles.infoGrid}>
                  <InfoItem label="전체 용량" value={bytes(ok.capacity)} />
                  <InfoItem label="사용량" value={bytes(ok.usedBytes)} />
                </View>
                <View style={{ height: AppSpacing.lg }} />
                <View style={styles.infoGrid}>
                  <InfoItem label="남은 용량" value={bytes(remaining)} />
                  <InfoItem
                    label="기록된 레코드"
                    value={ok.recordCount === undefined ? '확인 불가' : `${ok.recordCount}개`}
                  />
                </View>
                <View style={{ height: AppSpacing.lg }} />
                <View style={styles.infoGrid}>
                  <InfoItem label="NDEF 포맷" value="포맷됨" />
                  <InfoItem label="쓰기 가능 여부" value={ok.state === 'read_write' ? '가능' : '불가'} />
                </View>
                {ok.aarRecords?.map((record, index) => <InfoItem key={index} label="앱 바로 열기" value={`켜짐 · ${aarLabel(record)}`} />)}
              </>
            )}
          </>
        ) : null}

        {result && !result.ok ? (
          <AppInfoCard
            title={result.reason === 'status_unknown' ? '태그 상태를 확인할 수 없습니다' : '확인하지 못했습니다'}
            message={result.message}
            variant="error"
          />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <AppPrimaryButton label="홈으로" onPress={onHome} />
        <View style={{ height: AppSpacing.itemGap }} />
        <AppSecondaryButton label="다시 확인" onPress={onInspect} disabled={reading} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 24,
    paddingBottom: 20,
  },
  center: { textAlign: 'center' },
  subtitle: {
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    textAlign: 'center',
  },

  infoGrid: { flexDirection: 'row' },
  infoItem: { flex: 1 },
  infoLabel: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
  },
  infoValue: { ...AppText.titleMedium, marginTop: AppSpacing.xs },

  footer: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingBottom: AppSpacing.bottomSafePadding,
    paddingTop: 8,
  },
});
