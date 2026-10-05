// 기타(직접 입력) 전용 URL 입력 화면 — HANDOFF.md §4.6
// 프리셋 6종은 계정명 입력 화면(InstagramInputScreen)이 맡는다. 이 화면은 허용 문자 검증 없이
// 어떤 http(s) URL이든 받으므로, 프리셋이 여기로 새어 들어오면 안 된다 (STATUS 판정 2).

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
  const { links, addLink, updateLink } = useLinkWriter();
  const editIndex = route.params?.editIndex;
  const isEditing = editIndex !== undefined;
  const linkType = CUSTOM_LINK_TYPE;
  // initialText: 프리셋 입력 화면에서 "기타로 추가"로 넘어온 붙여넣기 원문
  const [text, setText] = useState(() =>
    route.params?.initialText ?? (isEditing ? links[editIndex]?.originalInput ?? '' : '')
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
    navigation.popTo('LinkEdit', undefined, { merge: true });
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
