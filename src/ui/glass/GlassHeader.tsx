import { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass, gradius, gspace } from '../../theme/glass';
import { GlassIcon } from './GlassIcon';
import { GlassText } from './GlassText';

/**
 * Back button and centred title on the deep green band, as the Orders,
 * Earnings and My vehicle screens use.
 *
 * `tone` is kept for callers that pass it, but the band is dark whatever it
 * says, so the title is always white.
 */
export function GlassHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  tone?: 'ink' | 'white';
  /** Right-hand slot: a status chip, a count pill. Keeps the title centred. */
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const fg = glass.bandInk;

  return (
    <View
      style={{
        backgroundColor: glass.band,
        paddingTop: insets.top + gspace.sm,
        paddingHorizontal: gspace.xl,
        paddingBottom: gspace.md,
        marginBottom: gspace.md,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: gradius.chip,
            backgroundColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.25)',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {/* Mirrored chevron — the icon set has no back-facing one. */}
          <GlassIcon name="chev" color={fg} size={18} style={{ transform: [{ scaleX: -1 }] }} />
        </Pressable>
      ) : (
        <View style={{ width: 40 }} />
      )}

      <GlassText variant="title" style={{ flex: 1, textAlign: 'center', color: fg }}>
        {title}
      </GlassText>

      {/* Balances the back button so the title sits truly centred, and holds
          the right-hand chip when there is one. */}
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}
