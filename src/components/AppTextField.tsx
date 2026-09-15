// 텍스트 입력 필드 — Flutter app_text_field 이식본

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppColors, AppRadius, AppSpacing, AppText } from '@/theme/tokens';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  hasError?: boolean;
  errorText?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'url';
}

export function AppTextField({
  value,
  onChangeText,
  placeholder,
  label,
  hasError,
  errorText,
  autoCapitalize = 'none',
  keyboardType = 'default',
}: Props) {
  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AppColors.textTertiary}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        style={[styles.input, hasError && styles.inputError]}
      />
      {hasError && errorText ? <Text style={styles.error}>{errorText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...AppText.titleMedium, marginBottom: AppSpacing.sm },
  input: {
    backgroundColor: AppColors.cardBackground,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: AppRadius.input,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...AppText.bodyLarge,
  },
  inputError: { borderColor: AppColors.error },
  error: { ...AppText.bodyMedium, color: AppColors.error, marginTop: 6 },
});
