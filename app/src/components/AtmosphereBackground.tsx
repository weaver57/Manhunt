import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, opacity, stroke, zIndex } from '@/constants/theme';

export type AtmosphereVariant = 'default' | 'home' | 'hero' | 'lobby' | 'quiet';

const CONTOURS = [
  'M-72 120 C18 48 98 58 142 108 C186 158 262 166 438 78',
  'M-90 158 C6 84 86 92 130 140 C180 196 278 198 452 118',
  'M-102 202 C-4 128 74 130 120 176 C176 232 292 240 462 164',
  'M-112 252 C-12 176 64 176 112 220 C174 278 306 286 468 210',
  'M-118 310 C-22 234 54 226 104 270 C168 326 320 336 474 260',
  'M-124 376 C-34 298 44 286 98 326 C162 374 330 388 482 314',
  'M-128 448 C-44 370 34 352 92 390 C158 434 342 444 490 370',
  'M-132 526 C-56 446 24 424 86 456 C154 496 350 510 496 434',
  'M-136 612 C-68 532 14 502 80 528 C148 562 360 578 502 500',
  'M-140 700 C-80 622 0 584 74 604 C142 634 370 648 508 570',
  'M-144 790 C-92 710 -14 670 68 684 C136 706 380 720 514 642',
];

export function AtmosphereBackground({ children, variant = 'default', style }: {
  children: ReactNode; variant?: AtmosphereVariant; style?: StyleProp<ViewStyle>;
}) {
  const showRings = variant === 'hero' || variant === 'lobby';
  const showRoleLight = variant === 'lobby';
  const showAmbient = variant !== 'quiet';
  return (
    <View style={[styles.root, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {showAmbient ? (
          <>
            <LinearGradient
              colors={[colors.atmosphere.ambientViolet, 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.ambientTop}
            />
            <LinearGradient
              colors={['transparent', colors.atmosphere.ambientBlue]}
              start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }}
              style={styles.ambientBottom}
            />
          </>
        ) : null}
        {showRoleLight ? (
          <>
            <LinearGradient colors={[colors.glow.chaser, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.chaserGlow} />
            <LinearGradient colors={['transparent', colors.glow.runner]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.runnerGlow} />
          </>
        ) : null}
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 800" preserveAspectRatio="xMidYMid slice">
          {CONTOURS.map((path) => (
            <Path key={path} d={path} fill="none" stroke={colors.atmosphere.contour} strokeWidth={stroke.border} />
          ))}
          {showRings ? (
            <>
              <Circle cx="180" cy="385" r="94" fill="none" stroke={colors.atmosphere.rings} strokeWidth={stroke.border} />
              <Circle cx="180" cy="385" r="146" fill="none" stroke={colors.atmosphere.rings} strokeWidth={stroke.border} />
              <Circle cx="180" cy="385" r="198" fill="none" stroke={colors.atmosphere.rings} strokeWidth={stroke.border} />
            </>
          ) : null}
        </Svg>
        <LinearGradient
          colors={[colors.atmosphere.vignette, 'transparent', colors.atmosphere.vignette]}
          locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          style={[styles.vignetteVertical, { opacity: opacity.vignetteLayer }]}
        />
        <LinearGradient
          colors={[colors.atmosphere.vignette, 'transparent', colors.atmosphere.vignette]}
          locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[styles.vignetteHorizontal, { opacity: opacity.vignetteLayer }]}
        />
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.bg.base },
  content: { flex: 1, zIndex: zIndex.hudBase },
  ambientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '62%' },
  ambientBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '58%' },
  chaserGlow: { position: 'absolute', top: 0, left: 0, width: '55%', height: '34%', opacity: opacity.roleGlow },
  runnerGlow: { position: 'absolute', top: 0, right: 0, width: '55%', height: '34%', opacity: opacity.roleGlow },
  vignetteVertical: { ...StyleSheet.absoluteFillObject, zIndex: zIndex.map + 1 },
  vignetteHorizontal: { ...StyleSheet.absoluteFillObject, zIndex: zIndex.map + 1 },
});
