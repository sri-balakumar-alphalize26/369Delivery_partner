import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass, gradius, gspace } from '../../theme/glass';
import { GlassIcon } from './GlassIcon';
import { GlassText } from './GlassText';

/** Back button and centred title, as the Orders / Earnings / Proof screens use. */
export function GlassHeader({
  title,
  onBack,
  tone = 'ink',
}: {
  title: string;
  onBack?: () => void;
  tone?: 'ink' | 'white';
}) {
  const insets = useSafeAreaInsets();
  const fg = tone === 'white' ? glass.white : glass.ink;

  return (
    <View
      style={{
        paddingTop: insets.top + gspace.sm,
        paddingHorizontal: gspace.xl,
        paddingBottom: gspace.md,
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
            backgroundColor: glass.fillLight,
            borderWidth: 1,
            borderColor: glass.border,
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

      {/* Balances the back button so the title sits truly centred. */}
      <View style={{ width: 40 }} />
    </View>
  );
}
