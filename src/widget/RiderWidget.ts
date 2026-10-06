import Constants, { ExecutionEnvironment } from 'expo-constants';
import { createElement as h } from 'react';
import { Platform } from 'react-native';
import type { WidgetSnapshot } from './widgetSnapshot';

/**
 * The home-screen widget: duty, today's deliveries and the job in hand, in the
 * app's green and lime. A tap anywhere opens the app.
 *
 *   369 Delivery            ● On duty
 *   5 delivered today
 *   Now: S00042 → Fatma
 *
 * The widget library is a native module that does not exist in Expo Go, and
 * merely importing it there crashes, so it is loaded only in a real build.
 */

export const WIDGET_NAME = 'RiderWidget';

type Lib = typeof import('react-native-android-widget');
let lib: Lib | null | undefined;
export function widgetLib(): Lib | null {
  if (lib !== undefined) return lib;
  lib = null;
  if (Platform.OS !== 'android') return lib;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return lib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require('react-native-android-widget') as Lib;
  } catch {
    lib = null;
  }
  return lib;
}

const BAND = '#0F3D2E';
const LIME = '#A3E635';
const SOFT = '#BFD9CB';

export function riderWidget(s: WidgetSnapshot | null) {
  const w = widgetLib();
  if (!w) return null;
  const { FlexWidget, TextWidget } = w;
  const onDuty = !!s?.onDuty;
  return h(
    FlexWidget,
    {
      clickAction: 'OPEN_APP',
      style: {
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: BAND,
        borderRadius: 16,
        padding: 14,
        flexDirection: 'column',
        justifyContent: 'space-between',
      },
    },
    h(
      FlexWidget,
      { style: { width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
      h(TextWidget, { text: '369 Delivery', style: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' } }),
      h(TextWidget, {
        text: onDuty ? '● On duty' : '○ Off duty',
        style: { fontSize: 13, fontWeight: '700', color: onDuty ? LIME : SOFT },
      })
    ),
    h(TextWidget, {
      text: s ? `${s.deliveredToday} delivered today` : 'Open the app to start',
      style: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
    }),
    h(TextWidget, {
      text: s?.now ? `Now: ${s.now}` : onDuty ? 'Waiting for jobs' : 'Tap to open',
      style: { fontSize: 13, color: SOFT },
      maxLines: 1,
      truncate: 'END',
    })
  );
}
