import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { color, tabular, type } from '../theme/tokens';

type Variant = keyof typeof type;

export interface AppTextProps extends TextProps {
  variant?: Variant;
  /** Tabular figures — use for money, counters, timers. */
  nums?: boolean;
  /** UPPERCASE with the label tracking. */
  upper?: boolean;
  tone?: 'ink' | 'soft' | 'white' | 'brand' | 'orange' | 'green' | 'red';
}

const tones: Record<NonNullable<AppTextProps['tone']>, string> = {
  ink: color.ink,
  soft: color.inkSoft,
  white: color.white,
  brand: color.brand,
  orange: color.orange,
  green: color.green,
  red: color.red,
};

export function Text({
  variant = 'body',
  nums,
  upper,
  tone = 'ink',
  style,
  ...rest
}: AppTextProps) {
  const composed: TextStyle[] = [
    type[variant] as TextStyle,
    { color: tones[tone] },
    nums ? tabular : null,
    upper ? { textTransform: 'uppercase' as const } : null,
    style as TextStyle,
  ].filter(Boolean) as TextStyle[];

  return <RNText allowFontScaling={false} {...rest} style={composed} />;
}
