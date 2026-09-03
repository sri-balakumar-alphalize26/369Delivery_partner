import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { cardColor, cardRadius, shadow, space } from '../theme/tokens';

/**
 * The Bold Cards surface: white, 20px radius, soft shadow.
 *
 * The Big Type system had no such component on purpose — separation there is
 * whitespace and hairlines. This exists only for screens on the new design.
 */
export function Card({
  children,
  style,
  floating,
}: {
  children: ReactNode;
  style?: ViewStyle;
  /** Stronger elevation, for sheets that sit over other content. */
  floating?: boolean;
  }) {
  return (
    <View
      style={[
        {
          backgroundColor: cardColor.card,
          borderRadius: cardRadius.card,
          padding: space.xl,
        },
        floating ? shadow.floating : shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}
