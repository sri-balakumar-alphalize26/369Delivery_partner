import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { glass, gtype } from '../../theme/glass';

type Variant = keyof typeof gtype;
type Tone = 'ink' | 'soft' | 'faint' | 'white' | 'indigo' | 'orange' | 'green' | 'red';

const TONES: Record<Tone, string> = {
  ink: glass.ink,
  soft: glass.inkSoft,
  faint: glass.inkFaint,
  white: glass.white,
  indigo: glass.indigo,
  orange: glass.orange,
  green: glass.green,
  red: glass.red,
};

export interface GlassTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Tabular figures — for money, counters and codes. */
  nums?: boolean;
  upper?: boolean;
}

export function GlassText({
  variant = 'body',
  tone = 'ink',
  nums,
  upper,
  style,
  ...rest
}: GlassTextProps) {
  const composed: (TextStyle | undefined)[] = [
    gtype[variant] as TextStyle,
    { color: TONES[tone] },
    nums ? { fontVariant: ['tabular-nums' as const] } : undefined,
    upper ? { textTransform: 'uppercase' as const } : undefined,
    style as TextStyle,
  ];

  return <RNText allowFontScaling={false} {...rest} style={composed} />;
}
