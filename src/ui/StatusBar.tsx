import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarState, space, statusBar } from '../theme/tokens';
import { Text } from './Text';

/**
 * The one piece of colour in the app. A solid band across the top whose colour
 * tells the rider their state from three metres away, without reading.
 *
 * Sits under the system status bar (safe-area padded) so the colour runs all
 * the way to the top edge of the screen.
 */
export function StatusBar({
  state,
  label,
  trailing,
}: {
  state: BarState;
  /** Overrides the default label, e.g. to append a countdown. */
  label?: string;
  trailing?: string;
}) {
  const insets = useSafeAreaInsets();
  const cfg = statusBar[state];

  return (
    <View
      style={{
        backgroundColor: cfg.bg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.md,
        paddingHorizontal: space.gutter,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text variant="label" upper style={{ color: cfg.fg }}>
        {label ?? cfg.label}
      </Text>
      {trailing ? (
        <Text variant="label" upper nums style={{ color: cfg.fg }}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}
