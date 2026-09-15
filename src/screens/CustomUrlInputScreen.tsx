// 커스텀 URL 입력 화면 — Flutter custom_url_input_screen.dart 이식본
// LinkedIn / GitHub / Linktree / Portfolio / 직접입력 공용

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppPrimaryButton } from '@/components/AppButton';
import { AppInfoCard } from '@/components/AppCards';
import { AppRingBadge } from '@/components/AppRingBadge';
import { AppTextField } from '@/components/AppTextField';
import { CUSTOM_LINK_TYPE, type UrlDraft } from '@/models/linkType';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { NdefSize } from '@/utils/ndefSize';
import { normalizeFullUrl, removeTrackingParams } from '@/utils/urlNormalizer';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppOpacity, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomUrlInput'>;

export function CustomUrlInputScreen({ navigation, route }: Props) {
  const { links, addLink, updateLink, selectedLinkType } = useLinkWriter();
  const editIndex = route.params?.editIndex;
  const isEditing = editIndex !== undefined;
  const linkType = isEditing ? links[editIndex]?.linkType ?? CUSTOM_LINK_TYPE : selectedLinkType ?? CUSTOM_LINK_TYPE;
  const [text, setText] = useState(() =>
    isEditing ? links[editIndex]?.originalInput ?? '' : ''
  );
  const [removeTracking, setRemoveTracking] = useState(true);

  const normalizedUrl = useMemo(() => {
    const normalized = normalizeFullUrl(text);
    if (normalized === null) return null;
    return removeTracking ? removeTrackingParams(normalized) : normalized;
  }, [text, removeTracking]);

  const hasInput = text.trim().length > 0;
  const showError = hasInput && normalizedUrl === null;

  const onNext = () => {
    if (normalizedUrl === null) return;
    const draft: UrlDraft = {
      linkType,
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
          <Text style={[AppText.headlineLarge, styles.centerTitle]}>{linkType.label} 링크</Text>
          <View style={{ height: AppSpacing.sm }} />
          <Text style={[AppText.bodyMedium, styles.centerSub]}>{linkType.description}</Text>

          <View style={{ height: AppSpacing.lg }} />
          <AppRingBadge icon={linkTypeIcon(linkType.id)} pulse />
          <View style={{ height: AppSpacing.xl }} />

          <AppTextField
            value={text}
            onChangeText={setText}
            label="URL"
            placeholder={linkType.placeholder}
            keyboardType="url"
            hasError={showError}
            errorText="올바른 URL이 아닙니다. (http/https 웹 주소만 가능)"
          />

          <View style={{ height: AppSpacing.md }} />
          <Pressable style={styles.switchRow} onPress={() => setRemoveTracking((v) => !v)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>추적 파라미터 제거</Text>
              <Text style={styles.switchDesc}>utm_source 등 불필요한 값을 URL에서 지웁니다.</Text>
            </View>
            <Switch value={removeTracking} onValueChange={setRemoveTracking} />
          </Pressable>

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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.cardBackground,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 14,
    padding: 14,
  },
  switchTitle: { ...AppText.titleMedium },
  switchDesc: {
    ...AppText.labelSmall,
    color: AppColors.textPrimary,
    opacity: AppOpacity.secondary,
    marginTop: AppSpacing.xs,
  },
  footer: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingBottom: AppSpacing.bottomSafePadding,
    paddingTop: 8,
  },
});
