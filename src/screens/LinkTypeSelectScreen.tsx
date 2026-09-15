// 링크 유형 선택 화면 — Flutter link_type_select_screen.dart 이식본

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppActionCard } from '@/components/AppCards';
import { LINK_TYPES, type LinkType } from '@/models/linkType';
import { useLinkWriter } from '@/state/LinkWriterContext';
import { linkTypeIcon } from '@/theme/icons';
import { AppColors, AppSpacing, AppText } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'LinkTypeSelect'>;


export function LinkTypeSelectScreen({ navigation }: Props) {
  const { selectLinkType } = useLinkWriter();

  const onSelect = (linkType: LinkType) => {
    selectLinkType(linkType);
    if (linkType.inputMode === 'username') {
      navigation.navigate('InstagramInput');
    } else {
      navigation.navigate('CustomUrlInput');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={AppText.headlineLarge}>링크 유형을 선택하세요</Text>
        <View style={{ height: 8 }} />
        <Text style={AppText.bodyMedium}>저장할 링크의 유형에 맞는 입력 방식을 선택하세요.</Text>
        <View style={{ height: 28 }} />

        {LINK_TYPES.map((linkType, i) => (
          <View key={linkType.id}>
            <AppActionCard
              icon={linkTypeIcon(linkType.id)}
              title={linkType.label}
              description={linkType.description}
              onPress={() => onSelect(linkType)}
            />
            {i < LINK_TYPES.length - 1 ? <View style={{ height: AppSpacing.itemGap }} /> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  content: {
    paddingHorizontal: AppSpacing.screenPadding,
    paddingTop: 8,
    paddingBottom: AppSpacing.bottomSafePadding,
  },
});
