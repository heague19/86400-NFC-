// Primary / Secondary 버튼 — Flutter app_primary_button / app_secondary_button 이식본

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppColors, AppOpacity, AppRadius, AppSizes, AppText } from '@/theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function AppPrimaryButton({ label, onPress, disabled, loading }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: inactive
            ? '#C7C7C7'
            : pressed
              ? AppColors.primaryPressed
              : AppColors.primary,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function AppSecondaryButton({ label, onPress, disabled }: Props) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        styles.secondary,
        { backgroundColor: pressed ? AppColors.backgroundSubtle : AppColors.cardBackground },
      ]}
    >
      <View>
        <Text style={[styles.secondaryLabel, disabled && { opacity: AppOpacity.disabled }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: AppSizes.buttonHeight,
    borderRadius: AppRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  secondary: {
    borderWidth: 1,
    borderColor: AppColors.borderStrong,
  },
  primaryLabel: {
    ...AppText.labelLarge,
    color: '#FFFFFF',
  },
  secondaryLabel: {
    ...AppText.labelLarge,
    color: AppColors.textPrimary,
  },
});
