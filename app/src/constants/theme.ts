import { Appearance } from 'react-native';

/** The single source of visual values for Manhunt. */
export const palette = {
  dark: {
    bg: { base: '#090B14', raised: '#0F1220' },
    surface: { 1: '#151929', 2: '#1C2136', 3: '#262C45' },
    border: { subtle: 'rgba(255,255,255,0.07)', strong: 'rgba(255,255,255,0.14)' },
    text: { primary: '#F3F5F9', secondary: '#A6ADBC', tertiary: '#778195' },
    brand: { primary: '#8E7CFF', soft: 'rgba(142,124,255,0.16)', onPrimary: '#090B14' },
    role: { chaser: '#FF5A5F', runner: '#3DD9EB', spectator: '#A6ADBC' },
    status: { success: '#4ADE9A', warning: '#FFB84D', danger: '#FF3B5C', info: '#6EA8FF' },
    rewardGold: '#F2C879',
    gradient: { brand: ['#8E7CFF', '#5B8CFF'], aurora: ['#B58CFF', '#FF7AC8'], panel: ['#151929', '#1C2136'] },
    glow: { brand: 'rgba(142,124,255,0.35)', chaser: 'rgba(255,90,95,0.35)', runner: 'rgba(61,217,235,0.35)' },
    atmosphere: { ambientViolet: 'rgba(142,124,255,0.22)', ambientBlue: 'rgba(91,140,255,0.14)', contour: 'rgba(255,255,255,0.05)', rings: 'rgba(255,255,255,0.06)', vignette: 'rgba(0,0,0,0.35)', highlight: 'rgba(255,255,255,0.10)' },
    overlay: 'rgba(0,0,0,0.55)',
    map: { land: '#0D1017', water: '#0A1626', park: '#0F1A17', road: '#1B2130', highway: '#242B3D', building: '#131824' },
  },
  light: {
    bg: { base: '#F4F5FA', raised: '#FFFFFF' },
    surface: { 1: '#FFFFFF', 2: '#EEF0F8', 3: '#E2E6F2' },
    border: { subtle: 'rgba(10,12,17,0.08)', strong: 'rgba(10,12,17,0.16)' },
    text: { primary: '#171B24', secondary: '#515A6B', tertiary: '#667085' },
    brand: { primary: '#6A55E6', soft: 'rgba(106,85,230,0.12)', onPrimary: '#FFFFFF' },
    role: { chaser: '#C93642', runner: '#087C91', spectator: '#596273' },
    status: { success: '#187A4C', warning: '#865400', danger: '#B4233A', info: '#2459A6' },
    rewardGold: '#805500',
    gradient: { brand: ['#705BEA', '#4777D5'], aurora: ['#8A5CC8', '#C34486'], panel: ['#FFFFFF', '#EEF0F8'] },
    glow: { brand: 'rgba(112,91,234,0.16)', chaser: 'rgba(201,54,66,0.12)', runner: 'rgba(8,124,145,0.12)' },
    atmosphere: { ambientViolet: 'rgba(112,91,234,0.12)', ambientBlue: 'rgba(71,119,213,0.10)', contour: 'rgba(23,27,36,0.05)', rings: 'rgba(23,27,36,0.06)', vignette: 'rgba(23,27,36,0.10)', highlight: 'rgba(255,255,255,0.75)' },
    overlay: 'rgba(10,12,17,0.32)',
    map: { land: '#E8EAF0', water: '#DCEAF2', park: '#E0EBDD', road: '#FFFFFF', highway: '#D4D8E2', building: '#DDE1EA' },
  },
  highContrast: {
    bg: { base: '#000000', raised: '#080808' },
    surface: { 1: '#101010', 2: '#1B1B1B', 3: '#292929' },
    border: { subtle: 'rgba(255,255,255,0.30)', strong: 'rgba(255,255,255,0.70)' },
    text: { primary: '#FFFFFF', secondary: '#E4E4E4', tertiary: '#C4C4C4' },
    brand: { primary: '#B8ACFF', soft: 'rgba(184,172,255,0.24)', onPrimary: '#000000' },
    role: { chaser: '#FF777B', runner: '#7AEFFF', spectator: '#E4E4E4' },
    status: { success: '#77FFC0', warning: '#FFD27D', danger: '#FF748C', info: '#8DBEFF' },
    rewardGold: '#FFE08C',
    gradient: { brand: ['#B8ACFF', '#89A9FF'], aurora: ['#D0AEFF', '#FF9FD8'], panel: ['#101010', '#1B1B1B'] },
    glow: { brand: 'rgba(184,172,255,0.40)', chaser: 'rgba(255,119,123,0.40)', runner: 'rgba(122,239,255,0.40)' },
    atmosphere: { ambientViolet: 'rgba(184,172,255,0.24)', ambientBlue: 'rgba(137,169,255,0.18)', contour: 'rgba(255,255,255,0.08)', rings: 'rgba(255,255,255,0.10)', vignette: 'rgba(0,0,0,0.55)', highlight: 'rgba(255,255,255,0.15)' },
    overlay: 'rgba(0,0,0,0.72)',
    map: { land: '#05070A', water: '#07192B', park: '#0C2116', road: '#343B49', highway: '#515B6F', building: '#202634' },
  },
} as const;

export type ThemePalette = {
  bg: { base: string; raised: string };
  surface: { 1: string; 2: string; 3: string };
  border: { subtle: string; strong: string };
  text: { primary: string; secondary: string; tertiary: string };
  brand: { primary: string; soft: string; onPrimary: string };
  role: { chaser: string; runner: string; spectator: string };
  status: { success: string; warning: string; danger: string; info: string };
  rewardGold: string;
  gradient: { brand: readonly [string, string]; aurora: readonly [string, string]; panel: readonly [string, string] };
  glow: { brand: string; chaser: string; runner: string };
  atmosphere: { ambientViolet: string; ambientBlue: string; contour: string; rings: string; vignette: string; highlight: string };
  map: { land: string; water: string; park: string; road: string; highway: string; building: string };
  overlay: string;
};

const systemPalette: ThemePalette = Appearance.getColorScheme() === 'light' ? palette.light : palette.dark;

export const colors = {
  ...systemPalette,
  surface: systemPalette.surface[1],
  ground: systemPalette.bg.base,
  surfaceAlt: systemPalette.surface[2],
  surfaceBase: systemPalette.surface[1],
  borderSubtle: systemPalette.border.subtle,
  borderStrong: systemPalette.border.strong,
  accent: systemPalette.brand.primary,
  accentDim: systemPalette.brand.primary,
  accentSoft: systemPalette.brand.soft,
  accentText: systemPalette.brand.onPrimary,
  critical: systemPalette.status.danger,
  success: systemPalette.status.success,
  warning: systemPalette.status.warning,
  chaser: systemPalette.role.chaser,
  runner: systemPalette.role.runner,
  spectator: systemPalette.role.spectator,
  text: { primary: systemPalette.text.primary, secondary: systemPalette.text.secondary, ghost: systemPalette.text.tertiary, tertiary: systemPalette.text.tertiary },
  border: systemPalette.border.subtle,
  gradient: {
    backdrop: [systemPalette.bg.base, systemPalette.bg.base] as const,
    card: systemPalette.gradient.panel,
    cta: systemPalette.gradient.brand,
    brand: systemPalette.gradient.brand,
    aurora: systemPalette.gradient.aurora,
  },
  gold: systemPalette.rewardGold,
  glow: systemPalette.glow,
  atmosphere: systemPalette.atmosphere,
} as const;

export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const space = spacing;
export const radius = { xs: 8, sm: 10, md: 16, lg: 24, xl: 32, full: 999 } as const;

export const typeScale = {
  display: { size: 44, line: 48 }, titleLarge: { size: 28, line: 34 },
  titleMedium: { size: 22, line: 28 }, bodyLarge: { size: 17, line: 24 },
  body: { size: 15, line: 22 }, bodySmall: { size: 13, line: 18 },
  label: { size: 12, line: 16 }, numeric: { size: 32, line: 36 }, numericSmall: { size: 20, line: 24 },
} as const;
export const fontSize = {
  xs: typeScale.label.size, sm: typeScale.bodySmall.size, base: typeScale.body.size,
  md: typeScale.bodyLarge.size, lg: typeScale.titleMedium.size, xl: typeScale.titleLarge.size,
  '2xl': typeScale.numeric.size, '3xl': typeScale.display.size,
} as const;
export const lineHeight = {
  xs: typeScale.label.line, sm: typeScale.bodySmall.line, base: typeScale.body.line,
  md: typeScale.bodyLarge.line, lg: typeScale.titleMedium.line, xl: typeScale.titleLarge.line,
  '2xl': typeScale.numeric.line, '3xl': typeScale.display.line,
} as const;
export const typography = {
  display: 'ManropeBold', displaySemiBold: 'ManropeSemiBold', displayRegular: 'ManropeRegular',
  body: 'ManropeRegular', bodyMedium: 'ManropeMedium', bodySemiBold: 'ManropeSemiBold',
  bodyBold: 'ManropeBold', mono: 'JetBrainsMonoRegular',
} as const;
export const displayText = {
  title: { fontFamily: typography.display, textTransform: 'none' as const, letterSpacing: -0.5 },
  label: { fontFamily: typography.bodySemiBold, textTransform: 'uppercase' as const, letterSpacing: 1.2 },
} as const;

export const size = { icon: 24, iconSmall: 20, buttonSmall: 40, buttonMedium: 48, buttonLarge: 56, row: 64, touch: 48, avatarSmall: 36, avatarMedium: 48, avatarLarge: 96, qrCode: 96, scannerMinHeight: 240, contentMax: 560 } as const;
export const stroke = { icon: 1.75, border: 1 } as const;
export const tracking = { tight: -0.5, normal: 0, label: 1, wide: 1.2, code: 2, spaced: 4 } as const;
export const typeRatio = { avatar: 0.4, avatarLine: 0.52 } as const;
export const opacity = { pressed: 0.92, disabled: 0.55, muted: 0.84, roleGlow: 0.35, vignetteLayer: 0.5, heroWash: 0.12 } as const;
export const scale = { pressed: 0.97 } as const;
export const sheet = { snapMin: '40%' as const, snapMid: '70%' as const, snapMax: '92%' as const };
export const motion = { fast: 120, base: 200, slow: 320, camera: 600, tag: 500 } as const;
export const duration = { fast: motion.fast, base: motion.base, slow: motion.slow, burst: motion.camera, zone: 1600, toast: 3000 } as const;
export const zIndex = { map: 0, hudBase: 10, modal: 20, toast: 30, sos: 40 } as const;
export const shadow = {
  sm: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 4 },
  md: { shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 24, elevation: 8 },
  button: { shadowColor: systemPalette.brand.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.20, shadowRadius: 24, elevation: 4 },
} as const;
