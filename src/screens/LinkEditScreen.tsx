// 수정/만들기 화면 — HANDOFF.md §4.3
// 태그 접촉 2회(읽기 1 + 저장 1)가 일어나는 유일한 화면.
// 목록에 링크를 쌓고, 대표를 지정하고, 용량을 확인한 뒤 한 번에 태그에 쓴다.
//
// 홈에서는 먼저 읽는다. 전달받은 읽기 결과와 같은 편집의 입력 화면 복귀는 재읽기하지 않는다.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export function LinkEditScreen({ navigation, route }: Props) {
  const { links, capacity, replaceFromTag, clear, removeLink, setPrimary } = useLinkWriter();
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const readRequest = useRef(0);
  const readPending = useRef(false);
  const mounted = useRef(false);
  const [writing, setWriting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onRead = useCallback(async () => {
    if (readPending.current || !navigation.isFocused()) return;
    const request = ++readRequest.current;
    readPending.current = true;
    setReady(false);
    setReading(true);
    setReadError(null);
    clear(); // 읽기 전 이전 태그의 목록과 용량을 사용할 수 없게 한다.
    try {
      const result = await NfcService.readUrl();
      if (!mounted.current || request !== readRequest.current || !navigation.isFocused()) return;
      const urls = result.ok
        ? result.urls ?? (result.url ? [result.url] : undefined)
        : result.reason === 'no_url' && result.urls?.length === 0 ? result.urls : undefined;
      if (urls && result.writable === true && typeof result.capacity === 'number' &&
          Number.isSafeInteger(result.capacity) && result.capacity > 0) {
        replaceFromTag(urls, result.capacity);
        setReady(true);
      } else {
        setReadError(result.writable === false
          ? '이 태그는 읽기 전용이라 수정할 수 없습니다.'
          : result.ok ? '태그 상태를 확인할 수 없습니다. 다시 읽어주세요.' : result.message);
      }
    } catch {
      if (mounted.current && request === readRequest.current && navigation.isFocused()) {
        setReadError('태그를 읽지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (mounted.current && request === readRequest.current) {
        readPending.current = false;
        setReading(false);
      }
    }
  }, [navigation, clear, replaceFromTag]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation.addListener('blur', () => {
      ++readRequest.current;
      if (readPending.current) {
        readPending.current = false;
        setReading(false);
        setReadError('태그 읽기가 중단되었습니다. 다시 읽어주세요.');
      }
    });
    setReady(false);
    setReadError(null);
    if (route.params) {
      const { urls, capacity: tagCapacity, writable } = route.params;
      clear();
      if (writable !== false && typeof tagCapacity === 'number' &&
          Number.isSafeInteger(tagCapacity) && tagCapacity > 0) {
        replaceFromTag(urls, tagCapacity);
        setReady(true);
      } else {
        setReadError(writable === false
          ? '이 태그는 읽기 전용이라 수정할 수 없습니다.'
          : '태그 상태를 확인할 수 없습니다. 다시 읽어주세요.');
      }
    } else {
      void onRead();
    }
    return () => {
      mounted.current = false;
      ++readRequest.current;
      readPending.current = false;
      unsubscribe();
    };
  }, [navigation, route.params, clear, replaceFromTag, onRead]);

  const urls = links.map((l) => l.normalizedUrl);
  const usedBytes = NdefSize.estimateMessageBytes(urls);
  // 실측 용량을 입력 화면 복귀에도 유지한다. 전체 폴백 정리는 4단계에서 처리한다.
  const totalCapacity = capacity ?? NdefSize.maxBytes;
  const overCapacity = usedBytes > totalCapacity;

  const onAddLink = () => {
    if (!ready || reading || writing || !navigation.isFocused()) return;
    navigation.navigate('LinkTypeSelect');
  };

  const onEditLink = (index: number) => {
    if (!ready || reading || writing || !navigation.isFocused()) return;
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
    if (!ready || reading || writing || !navigation.isFocused() || links.length === 0 || overCapacity) return;
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

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={AppText.headlineLarge}>태그를 먼저 읽으세요</Text>
          <View style={{ height: AppSpacing.sm }} />
          <Text style={AppText.bodyMedium}>휴대폰 뒷면을 태그에 대면 기존 링크를 불러옵니다.</Text>
          {readError ? (
            <>
              <View style={{ height: AppSpacing.lg }} />
              <AppInfoCard title="태그 읽기" message={readError} variant="error" />
            </>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <AppPrimaryButton label={reading ? '태그를 대세요…' : '다시 읽기'} onPress={onRead} loading={reading} />
        </View>
      </SafeAreaView>
    );
  }

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
          disabled={!ready || reading || links.length === 0 || overCapacity}
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
