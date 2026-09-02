import { useState } from 'react';
import { TextInput, TextInputProps, View } from 'react-native';
import { color, font, space } from '../theme/tokens';
import { Text } from './Text';

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
    <View style={{ marginBottom: space.xl }}>
      <Text variant="label" tone="soft" upper style={{ marginBottom: space.sm }}>
        {label}
      </Text>
      <TextInput
        allowFontScaling={false}
        placeholderTextColor={color.hairline}
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
            fontFamily: font.medium,
            fontSize: 20,
            color: color.ink,
            paddingVertical: space.md,
            borderBottomWidth: focused ? 2 : 1,
            borderBottomColor: focused ? color.brand : color.hairline,
          },
          style,
        ]}
      />
    </View>
  );
}
