import { ActivityIndicator, Pressable, ViewStyle } from 'react-native';
import { color, controlHeight, radius, space } from '../theme/tokens';
import { Text } from './Text';

type Kind = 'brand' | 'dark' | 'green' | 'orange' | 'ghost';

const kinds: Record<Kind, { bg: string; fg: 'white' | 'ink' }> = {
  brand: { bg: color.brand, fg: 'white' },
  dark: { bg: color.near, fg: 'white' },
  green: { bg: color.green, fg: 'white' },
  orange: { bg: color.orange, fg: 'ink' },
  ghost: { bg: 'transparent', fg: 'ink' },
};

/**
 * Full-width, 64px tall. There is never more than one of these visible —
 * the rider is on a bike and must have exactly one obvious next action.
 */
export function PrimaryButton({
  label,
  onPress,
  kind = 'brand',
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const cfg = kinds[kind];
  const off = disabled || loading;

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      style={({ pressed }) => [
        {
          height: controlHeight,
          borderRadius: radius,
          backgroundColor: cfg.bg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space.xl,
          opacity: off ? 0.4 : pressed ? 0.82 : 1,
        },
        kind === 'ghost' ? { height: 52 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={cfg.fg === 'white' ? color.white : color.ink} />
      ) : (
        <Text variant="button" tone={cfg.fg} upper>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
