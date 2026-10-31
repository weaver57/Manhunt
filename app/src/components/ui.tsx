import { useEffect, useState, type ReactNode, type ComponentType } from 'react';
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput,
  View, type StyleProp, type TextInputProps, type ViewStyle, type TextStyle,
} from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AlertTriangle, ArrowLeft, Check, Compass, Info, type LucideProps,
} from 'lucide-react-native';
import { colors, duration, fontSize, lineHeight, opacity, radius, scale, shadow, size, spacing, stroke, typography, sheet, tracking, typeRatio, zIndex } from '@/constants/theme';
import { AtmosphereBackground, type AtmosphereVariant } from './AtmosphereBackground';

type IconComponent = ComponentType<LucideProps>;

export function AppIcon({ icon: Icon, size: iconSize = size.icon, color = colors.text.secondary }: {
  icon: IconComponent; size?: number; color?: string;
}) {
  return <Icon size={iconSize} color={color} strokeWidth={stroke.icon} />;
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';
export function Button({
  label, onPress, variant = 'primary', size: buttonSize = 'lg', left, loading = false,
  disabled = false, block = true, accessibilityLabel, style,
}: {
  label: string; onPress: () => void; variant?: ButtonVariant; size?: ButtonSize;
  left?: ReactNode; loading?: boolean; disabled?: boolean; block?: boolean;
  accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const content = (
    <>
      {loading ? <ActivityIndicator size="small" color={variant === 'primary' ? colors.accentText : colors.text.primary} /> : left}
      {!loading && <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]} numberOfLines={2}>{label}</Text>}
    </>
  );
  return (
    <Pressable
      onPress={onPress} disabled={inactive} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button, styles[`button_${buttonSize}`], styles[`button_${variant}`],
        !block && styles.buttonInline, inactive && styles.buttonDisabled,
        pressed && !inactive && styles.buttonPressed, style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={colors.gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.buttonFill, styles[`buttonFill_${buttonSize}`]]}>
          {content}
          <LinearGradient pointerEvents="none" colors={[colors.atmosphere.highlight, 'transparent']} style={styles.buttonHighlight} />
        </LinearGradient>
      ) : (
        <View style={[styles.buttonFill, styles[`buttonFill_${buttonSize}`], styles[`buttonFill_${variant}`]]}>{content}</View>
      )}
    </Pressable>
  );
}

export function Card({ children, style, padding = 'md', accentEdge = false, tone = 'default' }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; padding?: 'none' | 'sm' | 'md' | 'lg'; accentEdge?: boolean; tone?: 'default' | 'hero';
}) {
  return (
    <LinearGradient colors={[colors.borderStrong, colors.borderSubtle]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cardFrame, style]}>
      <View style={[styles.card, styles[`card_${padding}`]]}>
        {tone === 'hero' ? <LinearGradient pointerEvents="none" colors={[...colors.gradient.brand, 'transparent']} locations={[0, 0.55, 1]} style={[StyleSheet.absoluteFill, styles.heroWash]} /> : null}
        <LinearGradient pointerEvents="none" colors={[colors.atmosphere.highlight, 'transparent']} style={styles.cardHighlight} />
        {accentEdge ? <View style={styles.cardEdge} /> : null}
        {children}
      </View>
    </LinearGradient>
  );
}

export function Chip({ label, selected = false, onPress, icon, accessibilityLabel, tone = 'neutral' }: {
  label: string; selected?: boolean; onPress?: () => void; icon?: IconComponent; accessibilityLabel?: string;
  tone?: 'neutral' | 'brand' | 'runner' | 'chaser' | 'spectator' | 'success' | 'warning' | 'danger';
}) {
  const toneColor = tone === 'runner' || tone === 'chaser' || tone === 'spectator'
    ? colors.role[tone]
    : tone === 'success' ? colors.status.success
    : tone === 'warning' ? colors.status.warning
    : tone === 'danger' ? colors.status.danger
    : tone === 'brand' ? colors.brand.primary
    : colors.text.secondary;
  const toneStyle = tone === 'neutral' ? null : { borderColor: toneColor };
  const content = <>{icon ? <AppIcon icon={icon} size={size.iconSmall} color={selected ? colors.accent : toneColor} /> : null}<Text style={[styles.chipText, selected && styles.chipTextSelected, tone !== 'neutral' && { color: toneColor }]}>{label}</Text></>;
  if (!onPress) return <View style={[styles.chip, selected && styles.chipSelected, toneStyle]}>{content}</View>;
  return (
    <Pressable
      onPress={onPress} accessibilityRole="radio" accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, toneStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function Avatar({ name, imageUrl, size: avatarSize = size.avatarMedium, color = colors.surfaceAlt }: {
  name: string; imageUrl?: string | null; size?: number; color?: string;
}) {
  return (
    <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: color }]} accessible accessibilityLabel={`Avatar for ${name}`}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.avatarImage} accessibilityLabel={`Photo of ${name}`} /> : <Text style={[styles.avatarText, { fontSize: avatarSize * typeRatio.avatar, lineHeight: avatarSize * typeRatio.avatarLine }]}>{name.trim().slice(0, 1).toUpperCase()}</Text>}
    </View>
  );
}

export function HudPill({ label, value, icon, tone = 'neutral' }: {
  label?: string; value: string; icon?: IconComponent; tone?: 'neutral' | 'brand' | 'warning' | 'danger' | 'success';
}) {
  const toneColor = tone === 'danger' ? colors.critical : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.accent;
  return (
    <View style={[styles.hudPill, styles[`hud_${tone}`]]} accessibilityRole="text">
      {icon ? <AppIcon icon={icon} size={size.iconSmall} color={tone === 'neutral' ? colors.text.secondary : toneColor} /> : null}
      <View style={styles.hudCopy}>
        {label ? <Text style={styles.hudLabel}>{label}</Text> : null}
        <Text style={styles.hudValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

export function ListRow({ title, subtitle, leading, trailing, onPress, style }: {
  title: string; subtitle?: string; leading?: ReactNode; trailing?: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const body = <><View style={styles.listLeading}>{leading}</View><View style={styles.listCopy}><Text style={styles.listTitle}>{title}</Text>{subtitle ? <Text style={styles.listSubtitle}>{subtitle}</Text> : null}</View>{trailing}</>;
  if (!onPress) return <View style={[styles.listRow, style]}>{body}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.listRow, pressed && styles.pressed, style]}>{body}</Pressable>;
}

export function Toggle({ label, value, onValueChange, hint, disabled = false }: {
  label: string; value: boolean; onValueChange: (value: boolean) => void; hint?: string; disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.listCopy}><Text style={styles.listTitle}>{label}</Text>{hint ? <Text style={styles.listSubtitle}>{hint}</Text> : null}</View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: colors.surfaceAlt, true: colors.accent }} thumbColor={colors.text.primary} accessibilityLabel={label} />
    </View>
  );
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string; style?: StyleProp<TextStyle>; error?: string;
}
export function Field({ label, style, error, ...inputProps }: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.text.tertiary} selectionColor={colors.accent} allowFontScaling
        {...inputProps}
        onFocus={(event) => { setFocused(true); inputProps.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); inputProps.onBlur?.(event); }}
        style={[styles.input, focused && styles.inputFocused, !!error && styles.inputError, style]}
      />
      {error ? <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children, action, style }: {
  children: string; action?: ReactNode; style?: StyleProp<TextStyle>;
}) {
  return <View style={styles.sectionLabelRow}><Text style={[styles.sectionLabelText, style]}>{children}</Text>{action}</View>;
}

export function PageHeader({ title, subtitle, eyebrow, onBack }: {
  title: string; subtitle?: string; eyebrow?: string; onBack?: () => void;
}) {
  return (
    <View style={styles.pageHeader}>
      {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={spacing[2]} style={styles.backButton}><AppIcon icon={ArrowLeft} /><Text style={styles.backText}>Back</Text></Pressable> : null}
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.pageTitle}>{title}</Text>
      {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function InlineNotice({ message, tone = 'info', action }: {
  message: string; tone?: 'info' | 'warning' | 'danger' | 'success'; action?: ReactNode;
}) {
  const NoticeIcon = tone === 'danger' || tone === 'warning' ? AlertTriangle : tone === 'success' ? Check : Info;
  return (
    <View style={[styles.notice, styles[`notice_${tone}`]]} accessibilityRole={tone === 'danger' ? 'alert' : 'text'}>
      <AppIcon icon={NoticeIcon} size={size.iconSmall} color={tone === 'danger' ? colors.critical : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.status.info} />
      <Text style={styles.noticeText}>{message}</Text>{action}
    </View>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <View style={styles.empty}><View style={styles.emptyMark}><AppIcon icon={Compass} color={colors.accent} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyMessage}>{message}</Text>{action}</View>;
}

export function Toast({ message, tone = 'info', visible = true }: { message: string; tone?: 'info' | 'warning' | 'danger' | 'success'; visible?: boolean }) {
  const [show, setShow] = useState(visible);
  useEffect(() => {
    setShow(visible);
    if (!visible) return undefined;
    const timer = setTimeout(() => setShow(false), duration.toast);
    return () => clearTimeout(timer);
  }, [message, visible]);
  if (!show) return null;
  return <View style={styles.toast} accessibilityRole="alert"><InlineNotice message={message} tone={tone} /></View>;
}

export function Sheet({ visible, onClose, title, children }: {
  visible: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.sheetScrim} onPress={onClose} accessibilityLabel="Close sheet">
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OfflineBanner() {
  const { isConnected, isInternetReachable } = useNetInfo();
  if (isConnected !== false && isInternetReachable !== false) return null;
  return <View style={styles.offlineBanner}><View style={styles.offlineDot} /><Text style={styles.offlineText}>Offline · changes may not sync</Text></View>;
}

export function Screen({ children, scroll = true, contentStyle, showOffline = true, atmosphere = 'default' }: {
  children: ReactNode; scroll?: boolean; contentStyle?: StyleProp<ViewStyle>; showOffline?: boolean; atmosphere?: AtmosphereVariant;
}) {
  const body = <>{showOffline ? <OfflineBanner /> : null}{children}</>;
  if (!scroll) {
    return (
      <AtmosphereBackground variant={atmosphere} style={[styles.screenFill, styles.screenStatic, contentStyle]}>
        {body}
      </AtmosphereBackground>
    );
  }
  return (
    <AtmosphereBackground variant={atmosphere} style={styles.screenFill}>
      <ScrollView
        style={styles.scroll} contentContainerStyle={[styles.screenContent, contentStyle]}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    </AtmosphereBackground>
  );
}

const styles = StyleSheet.create({
  screenFill: { flex: 1 },
  screenStatic: { paddingHorizontal: spacing[5], paddingVertical: spacing[4] },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  screenContent: { flexGrow: 1, paddingHorizontal: spacing[5], paddingTop: spacing[4], paddingBottom: spacing[8], gap: spacing[4], backgroundColor: 'transparent' },
  offlineBanner: { minHeight: size.buttonSmall, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: stroke.border, borderColor: colors.status.warning },
  offlineDot: { width: spacing[2], height: spacing[2], borderRadius: radius.full, backgroundColor: colors.status.warning },
  offlineText: { flex: 1, color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  button: { minHeight: size.buttonLarge, borderRadius: radius.md, borderWidth: stroke.border, overflow: 'hidden' },
  button_sm: { minHeight: size.touch },
  button_md: { minHeight: size.buttonMedium },
  button_lg: { minHeight: size.buttonLarge },
  button_primary: { borderColor: colors.brand.primary, ...shadow.button },
  button_secondary: { borderColor: colors.borderSubtle },
  button_danger: { borderColor: colors.status.danger },
  button_ghost: { borderColor: 'transparent' },
  buttonInline: { alignSelf: 'flex-start' },
  buttonFill: { flex: 1, minHeight: size.buttonLarge, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingHorizontal: spacing[5], overflow: 'hidden' },
  buttonFill_sm: { minHeight: size.touch },
  buttonFill_md: { minHeight: size.buttonMedium },
  buttonFill_lg: { minHeight: size.buttonLarge },
  buttonFill_secondary: { backgroundColor: colors.surfaceAlt },
  buttonFill_danger: { backgroundColor: colors.bg.raised },
  buttonFill_ghost: { backgroundColor: 'transparent' },
  buttonHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: spacing[3] },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { transform: [{ scale: scale.pressed }], opacity: opacity.pressed },
  pressed: { opacity: opacity.muted },
  buttonText: { fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md, textAlign: 'center' },
  buttonText_primary: { color: colors.brand.onPrimary },
  buttonText_secondary: { color: colors.text.primary },
  buttonText_danger: { color: colors.status.danger },
  buttonText_ghost: { color: colors.brand.primary },
  cardFrame: { borderRadius: radius.lg, overflow: 'hidden', padding: stroke.border },
  card: { flex: 1, position: 'relative', backgroundColor: colors.surfaceBase, borderRadius: radius.lg, overflow: 'hidden' },
  heroWash: { opacity: opacity.heroWash },
  cardHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: stroke.border },
  cardEdge: { height: stroke.border, width: '100%', backgroundColor: colors.brand.primary },
  card_none: { padding: spacing[0] },
  card_sm: { padding: spacing[3] },
  card_md: { padding: spacing[4] },
  card_lg: { padding: spacing[6] },
  chip: { minHeight: size.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderRadius: radius.full, borderWidth: stroke.border, borderColor: colors.borderSubtle, backgroundColor: colors.surfaceAlt },
  chipSelected: { borderColor: colors.brand.primary, backgroundColor: colors.brand.soft },
  chipText: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  chipTextSelected: { color: colors.brand.primary },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: colors.text.primary, fontFamily: typography.bodyBold, textAlign: 'center' },
  hudPill: { minHeight: size.buttonSmall, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], borderRadius: radius.full, backgroundColor: colors.bg.raised, borderWidth: stroke.border, borderColor: colors.borderSubtle },
  hud_neutral: {},
  hud_brand: { borderColor: colors.brand.primary },
  hud_warning: { borderColor: colors.status.warning },
  hud_danger: { borderColor: colors.status.danger },
  hud_success: { borderColor: colors.status.success },
  hudCopy: { gap: spacing[0] },
  hudLabel: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, textTransform: 'uppercase' },
  hudValue: { color: colors.text.primary, fontFamily: typography.mono, fontSize: fontSize.sm, lineHeight: lineHeight.sm, fontVariant: ['tabular-nums'] },
  listRow: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  listLeading: { minWidth: size.avatarSmall, alignItems: 'center' },
  listCopy: { flex: 1, gap: spacing[1] },
  listTitle: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md },
  listSubtitle: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  toggleRow: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  fieldGap: { gap: spacing[2] },
  fieldLabel: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, letterSpacing: tracking.label, textTransform: 'uppercase' },
  input: { minHeight: size.buttonLarge, borderRadius: radius.md, borderWidth: stroke.border, borderColor: colors.borderSubtle, paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.surfaceAlt, color: colors.text.primary, fontFamily: typography.body, fontSize: fontSize.md, lineHeight: lineHeight.md },
  inputFocused: { borderColor: colors.brand.primary },
  inputError: { borderColor: colors.status.danger },
  fieldError: { color: colors.status.danger, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  sectionLabelRow: { minHeight: size.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  sectionLabelText: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, letterSpacing: tracking.wide, textTransform: 'uppercase' },
  pageHeader: { gap: spacing[2], marginBottom: spacing[2] },
  backButton: { minHeight: size.touch, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing[2], paddingRight: spacing[3] },
  backText: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.base, lineHeight: lineHeight.base },
  eyebrow: { color: colors.brand.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, letterSpacing: tracking.wide, textTransform: 'uppercase' },
  pageTitle: { color: colors.text.primary, fontFamily: typography.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeight.xl, letterSpacing: tracking.tight },
  pageSubtitle: { maxWidth: size.contentMax, color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.base, lineHeight: lineHeight.base },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radius.md, borderWidth: stroke.border, backgroundColor: colors.bg.raised },
  notice_info: { borderColor: colors.status.info },
  notice_warning: { borderColor: colors.status.warning },
  notice_danger: { borderColor: colors.status.danger },
  notice_success: { borderColor: colors.status.success },
  noticeText: { flex: 1, color: colors.text.primary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[6], minHeight: spacing[16] },
  emptyMark: { width: size.buttonLarge, height: size.buttonLarge, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand.soft },
  emptyTitle: { color: colors.text.primary, fontFamily: typography.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeight.lg, textAlign: 'center' },
  emptyMessage: { maxWidth: size.contentMax, color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.base, lineHeight: lineHeight.base, textAlign: 'center' },
  toast: { position: 'absolute', top: spacing[4], left: spacing[5], right: spacing[5], zIndex: zIndex.toast },
  sheetScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { minHeight: sheet.snapMin, maxHeight: sheet.snapMax, gap: spacing[4], paddingHorizontal: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[8], borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.bg.raised, borderWidth: stroke.border, borderColor: colors.borderSubtle },
  sheetHandle: { width: spacing[8], height: spacing[1], borderRadius: radius.full, alignSelf: 'center', backgroundColor: colors.text.tertiary },
  sheetTitle: { color: colors.text.primary, fontFamily: typography.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeight.lg },
});




