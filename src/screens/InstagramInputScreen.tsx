// Instagram 입력 화면 — Flutter instagram_input_screen.dart 이식본

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppRingBadge } from '@/components/AppRingBadge';
import { AppTextField } from '@/components/AppTextField';
import { LINK_TYPES, type UrlDraft } from '@/models/linkType';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { NdefSize } from '@/utils/ndefSize';
import { normalizeInstagramUsername } from '@/utils/urlNormalizer';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'InstagramInput'>;

const INSTAGRAM = LINK_TYPES.find((t) => t.id === 'instagram')!;

export function InstagramInputScreen({ navigation, route }: Props) {
  const { addLink, updateLink, links } = useLinkWriter();
  const editIndex = route.params?.editIndex;
  const isEditing = editIndex !== undefined;
  const [text, setText] = useState(() =>
    isEditing ? links[editIndex]?.originalInput ?? '' : ''
  );

  const normalizedUrl = useMemo(() => normalizeInstagramUsername(text), [text]);
  const hasInput = text.trim().length > 0;
  const showError = hasInput && normalizedUrl === null;

  const onNext = () => {
    if (normalizedUrl === null) return;
    const draft: UrlDraft = {
      linkType: INSTAGRAM,
      originalInput: text.trim(),
      normalizedUrl,
      estimatedBytes: NdefSize.estimateUrlRecordBytes(normalizedUrl),
      isValid: true,
    };
    if (isEditing) {
      updateLink(editIndex, draft);
    } else {
      addLink(draft);
    }
    navigation.navigate('LinkEdit');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[AppText.headlineLarge, styles.centerTitle]}>Instagram 계정</Text>
          <View style={{ height: AppSpacing.sm }} />
          <Text style={[AppText.bodyMedium, styles.centerSub]}>
            계정명을 입력하면 Instagram 링크를 자동으로 만듭니다.
          </Text>

          <View style={{ height: AppSpacing.lg }} />
          <AppRingBadge icon={linkTypeIcon('instagram')} pulse />
          <View style={{ height: AppSpacing.xl }} />

          <AppTextField
            value={text}
            onChangeText={setText}
            label="계정명"
            placeholder={INSTAGRAM.placeholder}
            hasError={showError}
            errorText="올바른 Instagram 계정명이 아닙니다."
          />

          {normalizedUrl ? (
            <>
              <View style={{ height: AppSpacing.md }} />
              <AppInfoCard title="생성될 링크" message={normalizedUrl} variant="neutral" />
            </>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <AppPrimaryButton label="다음" onPress={onNext} disabled={normalizedUrl === null} />
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
