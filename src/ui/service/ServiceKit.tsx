import { ReactNode, useEffect } from 'react';
import { ActivityIndicator, Pressable, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ServiceJob, ServiceStatus, SERVICE_STATUS_LABEL } from '../../api/serviceTypes';
import { useNow } from '../../hooks/useNow';
import { secondsUntil } from '../../lib/clock';
import { timeOnly } from '../../lib/format';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../theme/glass';
import { servicePalette as S } from '../../theme/workspace';
import { GlassIcon, GlassIconName } from '../glass/GlassIcon';
import { GlassText } from '../glass/GlassText';

/**
 * The Service side's own building blocks: the indigo band, its buttons, the
 * status chip and the offer countdown. Same shapes as the delivery ones, in
 * Service colours, so the two sides read as one app.
 */

export function SvcHeader({
  eyebrow,
  title,
  onBack,
  right,
  children,
}: {
  eyebrow?: string;
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: S.band, paddingTop: insets.top + gspace.md, paddingBottom: gspace.lg }}>
      <View style={{ width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingHorizontal: gspace.xl }}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            style={({ pressed }) => ({ alignSelf: 'flex-start', marginBottom: gspace.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <GlassIcon name="undo" color={S.bandSoft} size={20} />
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: gspace.md }}>
          <View style={{ flex: 1 }}>
            {eyebrow ? (
              <GlassText variant="caption" style={{ color: S.bandSoft }}>
                {eyebrow}
              </GlassText>
            ) : null}
            <GlassText variant="hero" tone="white" numberOfLines={2}>
              {title}
            </GlassText>
            {children}
          </View>
          {right}
        </View>
      </View>
    </View>
  );
}

export function SvcButton({
  title,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'ghost' | 'danger' | 'quiet';
  icon?: GlassIconName;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? S.band : kind === 'danger' ? glass.red : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? glass.white : kind === 'quiet' ? glass.inkSoft : S.band;
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => ({
        minHeight: 52,
        borderRadius: gradius.button,
        backgroundColor: bg,
        borderWidth: kind === 'ghost' ? 2 : 0,
        borderColor: S.band,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: gspace.sm,
        paddingHorizontal: gspace.lg,
        opacity: off ? 0.5 : pressed ? 0.8 : 1,
        ...style,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <GlassIcon name={icon} color={fg} size={20} /> : null}
          <GlassText variant="button" style={{ color: fg }}>
            {title}
          </GlassText>
        </>
      )}
    </Pressable>
  );
}

const PILL: Partial<Record<ServiceStatus, { bg: string; fg: string }>> = {
  offered: { bg: S.accent, fg: S.accentInk },
  scheduled: { bg: S.soft, fg: S.band },
  signed_off: { bg: glass.greenSoft, fg: glass.green },
  revisit: { bg: glass.orangeSoft, fg: glass.orange },
  cancelled: { bg: glass.fill, fg: glass.inkSoft },
  failed: { bg: glass.redSoft, fg: glass.red },
};

export function StatusPill({ status, style }: { status: ServiceStatus; style?: ViewStyle }) {
  const c = PILL[status] ?? { bg: S.band, fg: glass.white };
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: gradius.pill, paddingHorizontal: gspace.sm, paddingVertical: 3, ...style }}>
      <GlassText variant="label" style={{ color: c.fg }}>
        {SERVICE_STATUS_LABEL[status]}
      </GlassText>
    </View>
  );
}

export function Chip({ label, tone = 'soft' }: { label: string; tone?: 'soft' | 'svc' | 'red' }) {
  const c =
    tone === 'svc' ? { bg: S.soft, fg: S.band } : tone === 'red' ? { bg: glass.redSoft, fg: glass.red } : { bg: glass.fill, fg: glass.inkSoft };
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: gradius.pill, paddingHorizontal: gspace.sm, paddingVertical: 3 }}>
      <GlassText variant="label" style={{ color: c.fg }}>
        {label}
      </GlassText>
    </View>
  );
}

export function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: glass.fill, borderRadius: gradius.chip, borderWidth: 1, borderColor: glass.border, padding: gspace.md }}>
      <GlassText variant="subtitle" nums numberOfLines={1}>
        {value}
      </GlassText>
      <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
        {label}
      </GlassText>
    </View>
  );
}

/** "Accept within 0:42", counted on the server's clock. Calls `onExpired` once at zero. */
export function Countdown({ expiresAt, onExpired }: { expiresAt?: string | null; onExpired?: () => void }) {
  const now = useNow(1000);
  const left = secondsUntil(expiresAt ?? undefined, now);
  const gone = left !== null && left <= 0;
  useEffect(() => {
    if (gone) onExpired?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);
  if (left === null) return null;
  const m = Math.floor(Math.max(0, left) / 60);
  const s = String(Math.max(0, left) % 60).padStart(2, '0');
  return (
    <View style={{ backgroundColor: gone ? glass.redSoft : glass.orangeSoft, borderRadius: gradius.chip, padding: gspace.md }}>
      <GlassText variant="bodyStrong" tone={gone ? 'red' : 'ink'} nums>
        {gone ? 'Offer expired – it went to another technician.' : `Accept within ${m}:${s}`}
      </GlassText>
    </View>
  );
}

export function km(m: number | null | undefined): string {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "3:00–4:00 pm" in the shop's zone. */
export function slotText(job: Pick<ServiceJob, 'slot_start' | 'slot_end'>, tz?: string): string {
  const a = timeOnly(job.slot_start, tz);
  const b = timeOnly(job.slot_end, tz);
  return a && b ? `${a}–${b}` : a;
}
