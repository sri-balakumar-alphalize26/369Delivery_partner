import { ReactNode } from 'react';
import { ScrollView, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from '../theme/tokens';

/**
 * Page shell. Owns the gutters so no screen invents its own, which is what
 * keeps the left edge of every screen on the same line.
 */
export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = {
    paddingHorizontal: space.gutter,
    paddingTop: space.xxl,
    paddingBottom: insets.bottom + space.xxl,
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: color.bg }, pad, style]}>{children}</View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={[pad, style]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}
