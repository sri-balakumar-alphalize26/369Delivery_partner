import { View, ViewStyle } from 'react-native';
import { space } from '../theme/tokens';
import { Text } from './Text';

/**
 * The hero of every screen: an enormous tabular number with a tiny uppercase
 * label beneath it. Hierarchy through size, which is the whole design idea.
 */
export function BigNumber({
  value,
  label,
  prefix,
  size = 'hero',
  tone = 'ink',
  style,
}: {
  value: string | number;
  label: string;
  prefix?: string;
  size?: 'hero' | 'big' | 'mid';
  tone?: 'ink' | 'white' | 'brand' | 'green';
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {prefix ? (
          <Text
            variant="title"
            tone={tone}
            style={{ marginTop: size === 'hero' ? 18 : 8, marginRight: 3 }}
          >
            {prefix}
          </Text>
        ) : null}
        <Text variant={size} tone={tone} nums>
          {value}
        </Text>
      </View>
      <Text
        variant="label"
        tone={tone === 'ink' ? 'soft' : tone}
        upper
        style={{ marginTop: size === 'hero' ? space.sm : space.xs, opacity: tone === 'white' ? 0.75 : 1 }}
      >
        {label}
      </Text>
    </View>
  );
}
