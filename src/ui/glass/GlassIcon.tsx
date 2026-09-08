import { Ionicons } from '@expo/vector-icons';
import { StyleProp, TextStyle } from 'react-native';
import { glass } from '../../theme/glass';

/**
 * The template's icon names mapped onto Ionicons.
 *
 * It shipped its own SVG set on react-native-svg; @expo/vector-icons is already
 * a dependency and already drives the tab bar, so this keeps every call site
 * working without adding a native module or an APK rebuild.
 */
const MAP = {
  home: 'home-outline',
  list: 'list-outline',
  wallet: 'wallet-outline',
  user: 'person-outline',
  nav: 'navigate',
  phone: 'call-outline',
  bell: 'notifications-outline',
  pin: 'location',
  store: 'storefront-outline',
  check: 'checkmark',
  checked: 'checkmark-circle',
  unchecked: 'ellipse-outline',
  clock: 'time-outline',
  chev: 'chevron-forward',
  star: 'star-outline',
  box: 'cube-outline',
  cash: 'cash-outline',
  compass: 'compass-outline',
  bike: 'bicycle',
  eye: 'eye-outline',
} as const;

export type GlassIconName = keyof typeof MAP;

export function GlassIcon({
  name,
  color = glass.ink,
  size = 22,
  style,
}: {
  name: GlassIconName;
  color?: string;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  return <Ionicons name={MAP[name]} size={size} color={color} style={style} />;
}
