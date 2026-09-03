import { View, ViewStyle } from 'react-native';
import { cardRadius, space } from '../theme/tokens';
import { Text } from './Text';

/**
 * The small uppercase pill on a card — job state, PICKUP, and so on.
 *
 * Colours are passed in rather than chosen here, so the caller can feed it
 * straight from `statusBar[state]` and keep one source of truth for what each
 * delivery status looks like.
 */
export function Badge({
  label,
  bg,
  fg,
  style,
}: {
  label: string;
  bg: string;
  fg: string;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: cardRadius.chip,
          paddingVertical: 6,
          paddingHorizontal: space.md,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text variant="cardLabel" upper style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}
