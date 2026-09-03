import { useState } from 'react';
import { TextInput, TextInputProps, View } from 'react-native';
import { glass, gspace, poppins } from '../theme/glass';
import { GlassText } from './glass/GlassText';

/**
 * Underlined input, not a boxed one — boxes read as cards, and this design has
 * no cards. The underline thickens and turns brand blue on focus.
 */
export function Field({
  label,
  style,
  ...rest
}: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ marginBottom: gspace.xl }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
        {label}
      </GlassText>
      <TextInput
        allowFontScaling={false}
        placeholderTextColor={glass.divider}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          {
            fontFamily: poppins.medium,
            fontSize: 20,
            color: glass.ink,
            paddingVertical: gspace.md,
            borderBottomWidth: focused ? 2 : 1,
            borderBottomColor: focused ? glass.indigo : glass.divider,
          },
          style,
        ]}
      />
    </View>
  );
}
