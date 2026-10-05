// 프리셋 공용 계정명 입력 화면 — HANDOFF.md §4.5
//
// 라우트·파일 이름은 Instagram 고정이던 시절 그대로지만 지금은 6종 프리셋 전부가 이 화면을 쓴다.
// 어떤 프리셋인지는 신규 추가면 selectedLinkType, 기존 행 수정이면 그 행의 linkType에서 읽는다.
// Instagram 같은 기본값으로 되돌아가지 않는다 — 그게 F2(X를 골라도 Instagram URL이 나옴)였다.

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton, AppSecondaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppRingBadge } from '@/components/AppRingBadge';
import { AppTextField } from '@/components/AppTextField';
import type { UrlDraft } from '@/models/linkType';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { NdefSize } from '@/utils/ndefSize';
import { describeWarnings, findDuplicate } from '@/utils/linkWarnings';
import { normalizePresetInput, type PresetInputResult } from '@/utils/urlNormalizer';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'InstagramInput'>;

const EMPTY_RESULT: PresetInputResult = { url: null, warnings: [], customSuggestion: null };

export function InstagramInputScreen({ navigation, route }: Props) {
  const { addLink, updateLink, links, selectedLinkType } = useLinkWriter();
  const editIndex = route.params?.editIndex;
  const isEditing = editIndex !== undefined;
  const linkType = isEditing ? links[editIndex]?.linkType : selectedLinkType;
  const [text, setText] = useState(() =>
    isEditing ? links[editIndex]?.originalInput ?? '' : ''
  );

  const result = useMemo(
    () => (linkType ? normalizePresetInput(linkType, text) : EMPTY_RESULT),
    [linkType, text]
  );
  const { url, customSuggestion } = result;
  const hasInput = text.trim().length > 0;
  // 기존 행을 고치는 중이면 그 행(editIndex)은 중복 비교에서 뺀다.
  const duplicate = linkType && url ? findDuplicate(links, { linkType, normalizedUrl: url }, editIndex) : null;
  const warnings = duplicate ? [...result.warnings, duplicate] : result.warnings;
  // 경고 배지를 먼저 만든 뒤(이 커밋) 다음 커밋에서 추가 차단을 푼다 (E5 순서 · 0-6).
  const blocked = url === null || result.warnings.length > 0;
  const showError = hasInput && url === null && customSuggestion === null;

  if (!linkType) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.content}>
          <AppInfoCard message="링크 유형을 먼저 선택하세요." variant="error" />
        </View>
      </SafeAreaView>
    );
  }

  const onNext = () => {
    if (url === null || blocked) return;
    const draft: UrlDraft = {
      linkType,
      originalInput: text.trim(),
      normalizedUrl: url,
      estimatedBytes: NdefSize.estimateUrlRecordBytes(url),
      isValid: true,
    };
    if (isEditing) {
      updateLink(editIndex, draft);
    } else {
      addLink(draft);
    }
    navigation.popTo('LinkEdit', undefined, { merge: true });
  };

  // 다른 서비스 주소를 붙여넣었을 때 — 같은 입력을 기타(URL 입력) 화면으로 넘긴다.
  const onAddAsCustom = () => {
    navigation.replace('CustomUrlInput', { editIndex, initialText: text.trim() });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[AppText.headlineLarge, styles.centerTitle]}>{linkType.label} 계정</Text>
          <View style={{ height: AppSpacing.sm }} />
          <Text style={[AppText.bodyMedium, styles.centerSub]}>
            계정명을 입력하면 {linkType.label} 링크를 자동으로 만듭니다.
          </Text>

          <View style={{ height: AppSpacing.lg }} />
          <AppRingBadge icon={linkTypeIcon(linkType.id)} pulse />
          <View style={{ height: AppSpacing.xl }} />

          <AppTextField
            value={text}
            onChangeText={setText}
            label="계정명"
            placeholder={linkType.placeholder}
            hasError={showError}
            errorText={`올바른 ${linkType.label} 계정명이 아닙니다.`}
          />

          {url ? (
            <>
              <View style={{ height: AppSpacing.md }} />
              <AppInfoCard title="생성될 링크" message={url} variant="neutral" />
            </>
          ) : null}

          {warnings.length > 0 ? (
            <>
              <View style={{ height: AppSpacing.sm }} />
              <AppInfoCard {...describeWarnings(warnings)} variant="warning" />
            </>
          ) : null}

          {customSuggestion ? (
            <>
              <View style={{ height: AppSpacing.md }} />
              <AppInfoCard
                title="다른 주소입니다"
                message={`${linkType.label} 계정 주소가 아닙니다. 기타 링크로 추가할까요?\n${customSuggestion}`}
                variant="neutral"
              />
              <View style={{ height: AppSpacing.sm }} />
              <AppSecondaryButton label="기타로 추가" onPress={onAddAsCustom} />
            </>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <AppPrimaryButton label="다음" onPress={onNext} disabled={blocked} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  centerTitle: { textAlign: 'center' },
  centerSub: { textAlign: 'center', color: AppColors.textPrimary, opacity: AppOpacity.secondary },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 8,
    paddingBottom: 20,
  },
  footer: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingBottom: AppSpacing.bottomSafePadding,
    paddingTop: 8,
  },
});
