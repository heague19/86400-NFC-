// 스플래시 화면 — 검은 배경 + 중앙 86400 로고
// CSS 스펙 이식: 배경 #000, 로고 183x110 중앙 배치

import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { Image, StatusBar, StyleSheet, View } from 'react-native';

import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    // 2초 후 홈으로 (뒤로가기 시 스플래시로 안 돌아오게 replace)
    const timer = setTimeout(() => {
      navigation.replace('Home');
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <Image
        source={require('../assets/logo_white.png')}
        style={styles.logo}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 183,
    height: 110,
  },
});
