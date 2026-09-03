import { View, ViewStyle } from 'react-native';
import { cardColor, cardRadius, space } from '../theme/tokens';
import { Text } from './Text';

/**
 * A number over a label on a tinted tile — the row of three under the headline
 * figure on the home card.
 */
export function StatChip({
  value,
  label,
  style,
}: {
  value: string | number;
  label: string;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: cardColor.chipBg,
          borderRadius: cardRadius.chip,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
        },
        style,
      ]}
    >
      <Text variant="cardStat" nums style={{ color: cardColor.textPrimary }}>
        {value}
      </Text>
      <Text variant="cardCaption" style={{ color: cardColor.textSecondary, marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}
