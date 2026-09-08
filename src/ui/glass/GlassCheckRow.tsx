import { Pressable, View } from 'react-native';
import { glass, gspace } from '../../theme/glass';
import { GlassIcon } from './GlassIcon';
import { GlassText } from './GlassText';

/**
 * One line of a parcel's contents.
 *
 * Two jobs in one component deliberately: without `onToggle` it is the plain
 * read-only row every job layout shows, and with it the rider can tick the item
 * off against what the shop is handing over. Splitting them into two components
 * is how the two lists drift apart — the tickable one grows a padding the plain
 * one does not, and the same parcel reads differently on two screens.
 *
 * Ticking is the rider's own aid and is never sent anywhere: no field on the
 * contract carries it, and Odoo alone decides whether the pickup may proceed.
 */
export function GlassCheckRow({
  name,
  quantity,
  checked = false,
  onToggle,
}: {
  name: string;
  quantity: number;
  checked?: boolean;
  onToggle?: () => void;
}) {
  const row = (
    <>
      {onToggle ? (
        <GlassIcon
          name={checked ? 'checked' : 'unchecked'}
          color={checked ? glass.green : glass.inkFaint}
          size={22}
          style={{ marginRight: gspace.md }}
        />
      ) : null}
      <GlassText
        variant="body"
        tone={checked ? 'faint' : 'ink'}
        style={{ flex: 1 }}
      >
        {name}
      </GlassText>
      <GlassText variant="body" tone="soft" nums>
        x{quantity}
      </GlassText>
    </>
  );

  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    // Taller when it is a control: at the plain row's 8 the tap target came to
    // about 36px, under the 44 a gloved thumb at a counter needs.
    paddingVertical: onToggle ? gspace.md : gspace.sm,
    borderBottomWidth: 1,
    borderBottomColor: glass.divider,
  };

  if (!onToggle) return <View style={style}>{row}</View>;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${name}, ${quantity}`}
      style={({ pressed }) => [style, pressed ? { opacity: 0.6 } : null]}
    >
      {row}
    </Pressable>
  );
}
