import { View, ViewStyle } from 'react-native';
import { color, space } from '../theme/tokens';

/** The only separator in this design. Never a card edge, never a shadow. */
export function Hairline({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[
        { height: 1, backgroundColor: color.hairline, marginVertical: space.xl },
        style,
      ]}
    />
  );
}
