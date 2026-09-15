// 앱 진입점 — Flutter app.dart + main.dart 이식본
// 네비게이션 스택 + 전역 상태 Provider 구성

import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LinkWriterProvider } from '@/state/LinkWriterContext';
import { SplashScreen } from '@/screens/SplashScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { LinkTypeSelectScreen } from '@/screens/LinkTypeSelectScreen';
import { InstagramInputScreen } from '@/screens/InstagramInputScreen';
import { CustomUrlInputScreen } from '@/screens/CustomUrlInputScreen';
import { LinkEditScreen } from '@/screens/LinkEditScreen';
import { TagReadScreen } from '@/screens/TagReadScreen';
import { TagInfoScreen } from '@/screens/TagInfoScreen';
import { WriteCompleteScreen } from '@/screens/WriteCompleteScreen';
import { AppColors } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: AppColors.background,
    card: AppColors.background,
    text: AppColors.textPrimary,
    primary: AppColors.primary,
    border: AppColors.border,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <LinkWriterProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="dark" />
          <Stack.Navigator
            initialRouteName="Splash"
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: AppColors.background },
              headerTintColor: AppColors.textPrimary,
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: AppColors.background },
            }}
          >
            <Stack.Screen name="Splash" component={SplashScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="LinkTypeSelect"
              component={LinkTypeSelectScreen}
              options={{ title: '' }}
            />
            <Stack.Screen name="InstagramInput" component={InstagramInputScreen} options={{ title: '' }} />
            <Stack.Screen name="CustomUrlInput" component={CustomUrlInputScreen} options={{ title: '' }} />
            <Stack.Screen name="LinkEdit" component={LinkEditScreen} options={{ title: '' }} />
            <Stack.Screen name="TagRead" component={TagReadScreen} options={{ title: '' }} />
            <Stack.Screen name="TagInfo" component={TagInfoScreen} options={{ title: '' }} />
            <Stack.Screen
              name="WriteComplete"
              component={WriteCompleteScreen}
              options={{ title: '', headerBackVisible: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </LinkWriterProvider>
    </SafeAreaProvider>
  );
}
