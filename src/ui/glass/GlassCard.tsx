import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { glass, gradius, gshadow } from '../../theme/glass';

/** A white card with a visible outline — its edge is the border, not a shadow. */
export function GlassCard({
  children,
  style,
  padding = 18,
}: {
  children: ReactNode;
  style?: ViewStyle;
  padding?: number;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: glass.bg,
          borderRadius: gradius.card,
          borderWidth: 1,
          borderColor: glass.border,
          padding,
        },
        gshadow.glass,
        style,
      ]}
    >
      {children}
    </View>
  );
}
