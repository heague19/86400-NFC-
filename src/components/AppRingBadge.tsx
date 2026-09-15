// 동심원 배지 — 시안 04_계정입력 / 05_태그연결 공통 요소
// 바깥 옅은 원 + 안쪽 진한 원 + 중앙 콘텐츠(아이콘 또는 텍스트)
//
// pulse 옵션: 중앙에서 바깥으로 원이 퍼져나가는 애니메이션 (NFC 태그 대기 표현)

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, ImageSourcePropType, StyleSheet, Text, View } from 'react-native';

import { AppColors, AppOpacity } from '@/theme/tokens';

interface Props {
  /** 중앙에 넣을 아이콘. 없으면 label 텍스트를 표시 */
  icon?: ImageSourcePropType;
  /** 아이콘 대신 표시할 텍스트 (시안 05의 "NFC") */
  label?: string;
  /** 바깥 원 지름 */
  size?: number;
  /** 활성 상태 — 중간 원을 진하게 (쓰기 진행 중 표시) */
  active?: boolean;
  /** 원이 퍼져나가는 애니메이션 (기본 off) */
  pulse?: boolean;
  /** 동시에 퍼지는 링 개수 */
  pulseCount?: number;
  /** 한 링이 퍼지는 데 걸리는 시간(ms) */
  pulseDuration?: number;
}

/** 중앙에서 바깥으로 1회 퍼져나가는 링 하나 */
function PulseRing({
  size,
  delay,
  duration,
}: {
  size: number;
  delay: number;
  duration: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        // 다음 주기 전에 즉시 원위치 (보이지 않게 opacity 0 상태)
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [progress, delay, duration]);

  // 안쪽 원(0.66) 크기에서 시작해 바깥(1.0)을 살짝 넘어서까지 확장
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1.06],
  });
  // 퍼지면서 서서히 사라짐
  const opacity = progress.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 0.55, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ scale }],
          opacity,
        },
      ]}
    />
  );
}

export function AppRingBadge({
  icon,
  label,
  size = 235,
  active = false,
  pulse = false,
  pulseCount = 3,
  pulseDuration = 2000,
}: Props) {
  // 시안 05_태그연결 비율 — 바깥 235 / 중간 187 / 안쪽 143
  const middle = size * 0.796;
  const inner = size * 0.609;
  const content = size * 0.28;

  return (
    <View style={[styles.outer, { width: size, height: size, borderRadius: size / 2 }]}>
      {pulse
        ? Array.from({ length: pulseCount }).map((_, i) => (
            <PulseRing
              key={i}
              size={size}
              // 링들이 일정 간격을 두고 순차적으로 퍼지도록
              delay={(pulseDuration / pulseCount) * i}
              duration={pulseDuration}
            />
          ))
        : null}

      {/* 중간 원 — 시안 Ellipse 120 (#606060, 3px) */}
      <View
        pointerEvents="none"
        style={[
          styles.middle,
          {
            width: middle,
            height: middle,
            borderRadius: middle / 2,
            borderColor: active ? AppColors.textPrimary : AppColors.ringInner,
          },
        ]}
      />

      {/* 안쪽 원 — 시안 Ellipse 119 (#000000, 5px) */}
      <View
        style={[
          styles.inner,
          {
            width: inner,
            height: inner,
            borderRadius: inner / 2,
          },
        ]}
      >
        {icon ? (
          <Image
            source={icon}
            style={{ width: content, height: content, borderRadius: content * 0.25 }}
            resizeMode="contain"
          />
        ) : (
          <Text style={[styles.label, { fontSize: size * 0.105 }]}>{label}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: AppColors.ringOuter,
  },
  middle: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: AppColors.ringInner,
    // 안쪽(검정 5px) > 중간 > 바깥 순으로 시선이 모이도록
    opacity: AppOpacity.tertiary,
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppColors.background,
    borderWidth: 5,
    borderColor: AppColors.textPrimary,
  },
  label: { fontWeight: '700', color: AppColors.textPrimary, letterSpacing: 1 },
  pulseRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: AppColors.ringInner,
  },
});
