// 수정/만들기 화면 — HANDOFF.md §4.3
// 태그 접촉 2회(읽기 1 + 저장 1)가 일어나는 유일한 화면.
// 목록에 링크를 쌓고, 대표를 지정하고, 용량을 확인한 뒤 한 번에 태그에 쓴다.
//
// 이 화면 진입 시 태그를 다시 읽지 않는다 (HomeScreen에서 바로 진입하는 "신규" 흐름과
// TagReadScreen "수정하기"로 들어오는 흐름 둘 다, 태그 접촉은 이미 다른 곳에서 처리됨).

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppCapacityGauge } from '@/components/AppCapacityGauge';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { NfcService } from '@/nfc/nfcService';
import { NdefSize } from '@/utils/ndefSize';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppRadius, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'LinkEdit'>;

export function LinkEditScreen({ navigation }: Props) {
  const { links, removeLink, setPrimary } = useLinkWriter();
  const [writing, setWriting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const urls = links.map((l) => l.normalizedUrl);
  const usedBytes = NdefSize.estimateMessageBytes(urls);
  // HANDOFF.md §2.2 — 분모는 항상 실측값. 이 화면은 이전 단계(홈/읽기)에서
  // 이미 태그를 읽었다는 전제이지만, 아직 실측 capacity를 들고 올 경로가 없어
  // 우선 NTAG213 기본값으로 표시한다. (TODO: 진입 시 전달받은 실측 capacity로 교체)
  const totalCapacity = NdefSize.maxBytes;
  const overCapacity = usedBytes > totalCapacity;

  const onAddLink = () => {
    navigation.navigate('LinkTypeSelect');
  };

  const onEditLink = (index: number) => {
    const link = links[index];
    if (link.linkType.inputMode === 'username') {
      navigation.navigate('InstagramInput', { editIndex: index });
    } else {
      navigation.navigate('CustomUrlInput', { editIndex: index });
    }
  };

  const onRemoveLink = (index: number) => {
    Alert.alert('링크 삭제', '이 링크를 목록에서 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => removeLink(index) },
    ]);
  };

  const onSave = async () => {
    if (links.length === 0 || overCapacity) return;
    setWriting(true);
    setErrorMsg(null);
    const result = await NfcService.writeUrls(urls);
    setWriting(false);

    if (result.ok) {
      navigation.navigate('WriteComplete', {
        urls,
        linkTypeId: links[0]?.linkType.id,
      });
    } else if (result.reason !== 'cancelled') {
      setErrorMsg(result.message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={AppText.headlineLarge}>링크를 편집하세요</Text>
        <View style={{ height: AppSpacing.sm }} />
        <Text style={AppText.bodyMedium}>
          추가·삭제·수정 후 저장하면 태그에 기록됩니다.
        </Text>

        <View style={{ height: AppSpacing.lg }} />
        <AppCapacityGauge used={usedBytes} total={totalCapacity} linkCount={links.length} />

        <View style={{ height: AppSpacing.lg }} />

        {links.length === 0 ? (
          <AppInfoCard
            title="링크 없음"
            message="아래 '링크 추가'로 첫 번째 링크를 만들어보세요."
            variant="neutral"
          />
        ) : (
          links.map((link, index) => {
            const isPrimary = index === 0;
            return (
              <View key={`${link.linkType.id}-${index}`}>
                <View style={styles.linkRow}>
                  <Pressable style={styles.linkMain} onPress={() => onEditLink(index)}>
                    <Image
                      source={linkTypeIcon(link.linkType.id)}
                      style={styles.linkIcon}
                      resizeMode="contain"
                    />
                    <View style={styles.linkTextCol}>
                      <View style={styles.linkTitleRow}>
                        <Text style={styles.linkTitle}>{link.linkType.label}</Text>
                        {isPrimary ? (
                          <View style={styles.primaryBadge}>
                            <Text style={styles.primaryBadgeText}>대표 · 탭하면 이 링크가 열립니다</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.linkUrl} numberOfLines={1}>
                        {link.normalizedUrl}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={styles.linkActions}>
                    {!isPrimary ? (
                      <Pressable style={styles.actionBtn} onPress={() => setPrimary(index)}>
                        <Text style={styles.actionBtnText}>대표 지정</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={styles.deleteBtn} onPress={() => onRemoveLink(index)}>
                      <Text style={styles.deleteBtnText}>삭제</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={{ height: AppSpacing.itemGap }} />
              </View>
            );
          })
        )}

        <AppSecondaryButton label="링크 추가" onPress={onAddLink} />

        {overCapacity ? (
          <>
            <View style={{ height: 14 }} />
            <AppInfoCard
              title="용량 초과"
              message="태그 용량을 초과했습니다. 링크를 줄여야 저장할 수 있습니다."
              variant="error"
            />
          </>
        ) : null}

        {errorMsg ? (
          <>
            <View style={{ height: 14 }} />
            <AppInfoCard title="저장 실패" message={errorMsg} variant="error" />
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <AppPrimaryButton
          label={writing ? '태그를 대세요…' : '저장'}
          onPress={onSave}
          disabled={links.length === 0 || overCapacity}
          loading={writing}
        />
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
  linkRow: {
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: AppRadius.card,
    padding: 14,
  },
  linkMain: { flexDirection: 'row', alignItems: 'center' },
  linkIcon: { width: 38, height: 38, borderRadius: 9 },
  linkTextCol: { flex: 1, marginLeft: 12 },
  linkTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  linkTitle: { ...AppText.titleMedium },
  primaryBadge: {
    marginLeft: AppSpacing.sm,
    backgroundColor: AppColors.primary,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  primaryBadgeText: { ...AppText.labelSmall, color: '#FFFFFF' },
  linkUrl: {
    ...AppText.bodyMedium,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    marginTop: 3,
  },
  linkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 8,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: AppColors.borderStrong,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionBtnText: { ...AppText.labelSmall, color: AppColors.textPrimary },
  deleteBtn: {
    borderWidth: 1,
    borderColor: AppColors.error,
    borderRadius: AppRadius.badge,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteBtnText: { ...AppText.labelSmall, color: AppColors.error },
  footer: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingBottom: AppSpacing.bottomSafePadding,
    paddingTop: 8,
  },
});
