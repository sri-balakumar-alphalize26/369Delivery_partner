import { View, ViewStyle } from 'react-native';
import { cardColor } from '../theme/tokens';
import { Text } from './Text';

/**
 * Initials on an orange disc. There is no avatar image anywhere in the API
 * contract, so initials are the only honest thing to draw.
 */
export function Avatar({
  name,
  size = 46,
  style,
}: {
  name: string | undefined;
  size?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: cardColor.orange,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text variant="cardTitle" style={{ color: cardColor.card, fontSize: size * 0.36 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

/** First letters of the first two words — "Arjun Menon" becomes "AM". */
function initials(name: string | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
