import { ReactNode, useState } from 'react';
import { TextInput, TextInputProps, View } from 'react-native';
import { glass, gspace, poppins } from '../theme/glass';
import { GlassIcon, GlassIconName } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * Underlined input, not a boxed one — boxes read as cards, and this design has
 * no cards. The underline thickens and turns brand blue on focus.
 *
 * `icon` sits before the text and `right` after it (a show-password eye, say);
 * `left` takes the icon's place for something richer (a country code chip).
 * All live inside the underline so the line still spans the whole field.
 */
export function Field({
  label,
  icon,
  left,
  right,
  style,
  ...rest
}: TextInputProps & { label: string; icon?: GlassIconName; left?: ReactNode; right?: ReactNode }) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ marginBottom: gspace.xl }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
        {label}
      </GlassText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: focused ? 2 : 1,
          borderBottomColor: focused ? glass.indigo : glass.divider,
        }}
      >
        {left ? (
          left
        ) : icon ? (
          <GlassIcon
            name={icon}
            size={20}
            color={focused ? glass.indigo : glass.inkFaint}
            style={{ marginRight: gspace.md }}
          />
        ) : null}
        <TextInput
          allowFontScaling={false}
          placeholderTextColor={glass.inkFaint}
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
              flex: 1,
              // 16, the usual size for a phone form. The grey example text
              // takes the same size in the lighter face, so it reads as a
              // hint and not as something already typed.
              fontFamily: rest.value ? poppins.medium : poppins.regular,
              fontSize: 16,
              color: glass.ink,
              paddingVertical: gspace.md,
            },
            style,
          ]}
        />
        {right}
      </View>
    </View>
  );
}
