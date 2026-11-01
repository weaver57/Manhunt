import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, opacity } from '@/constants/theme';

/** Edge-only light over the live map; the center stays clear for navigation. */
export function MapEdgeAtmosphere({ urgentRole }: { urgentRole?: 'chaser' | 'runner' }) {
  const roleGlow = urgentRole === 'chaser' ? colors.glow.chaser : urgentRole === 'runner' ? colors.glow.runner : null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[colors.atmosphere.vignette, 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={[styles.edge, styles.top]}
      />
      <LinearGradient
        colors={roleGlow ? [roleGlow, 'transparent'] : [colors.atmosphere.vignette, 'transparent']}
        start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }}
        style={[styles.edge, styles.bottom, { opacity: roleGlow ? opacity.roleGlow : opacity.vignetteLayer }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, right: 0, height: '22%' },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
