import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { glass, gradius, gshadow } from '../../theme/glass';

/**
 * The frosted card.
 *
 * A translucent tinted panel rather than a true blur, exactly as the template
 * ships it — a real blur-behind needs expo-blur, a native module that would
 * force a rebuild. Over the soft mesh the difference is barely visible.
 */
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
