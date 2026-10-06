import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { hasLocationPermission } from '../location/tracking';

/**
 * "Set up your phone": the checklist the big rider apps show on first start,
 * so a job is never missed because of a phone setting.
 *
 * Two kinds of row. Notifications and location are read from the phone. The
 * rest - battery, the full-screen ring, Do Not Disturb, the phone maker's
 * autostart - have no reliable way to be read, so the rider ticks "Done" after
 * the button has taken them to the right settings page; the tick is kept on the
 * phone. The battery tick is the one `DutyWatchRow` already keeps.
 */

export type SetupKey = 'notifications' | 'location' | 'battery' | 'fullScreen' | 'dnd' | 'autostart';

export interface SetupItem {
  key: SetupKey;
  title: string;
  why: string;
  /** What to switch on, on the page the button opens. */
  steps?: string;
  done: boolean;
  /** Read from the phone (true) or ticked by the rider (false). */
  checked: boolean;
  button: string;
}

const TICKS_KEY = 'd369.phoneSetup';
const BATTERY_KEY = 'd369.batteryAsked';

const PACKAGE =
  (Constants.expoConfig?.android as { package?: string } | undefined)?.package ??
  'com.alphalize.deliverypartner';

/**
 * The phone makers that stop apps in the background unless told not to, with
 * the screen where that is done. Several screens per maker: the name moves
 * between versions, so each is tried in turn.
 */
const MAKERS: {
  brands: string[];
  name: string;
  steps: string;
  screens: { packageName: string; className: string }[];
}[] = [
  {
    brands: ['xiaomi', 'redmi', 'poco'],
    name: 'Xiaomi',
    steps: 'Autostart ▸ turn on 369 Delivery Partner',
    screens: [
      { packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
    ],
  },
  {
    brands: ['oppo', 'realme'],
    name: 'Oppo / realme',
    steps: 'Auto launch (Startup manager) ▸ turn on 369 Delivery Partner',
    screens: [
      { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
      { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
      { packageName: 'com.oppo.safe', className: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
    ],
  },
  {
    brands: ['vivo', 'iqoo'],
    name: 'Vivo',
    steps: 'Background start / High background power ▸ allow 369 Delivery Partner',
    screens: [
      { packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
      { packageName: 'com.iqoo.secure', className: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' },
    ],
  },
  {
    brands: ['oneplus'],
    name: 'OnePlus',
    steps: 'Auto launch ▸ turn on 369 Delivery Partner',
    screens: [
      { packageName: 'com.oneplus.security', className: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' },
    ],
  },
  {
    brands: ['huawei', 'honor'],
    name: 'Huawei / Honor',
    steps: 'App launch ▸ 369 Delivery Partner ▸ Manage manually, all three on',
    screens: [
      { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
      { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
    ],
  },
  {
    brands: ['samsung'],
    name: 'Samsung',
    steps: 'Background usage limits ▸ Never sleeping apps ▸ add 369 Delivery Partner',
    screens: [
      { packageName: 'com.samsung.android.lool', className: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
    ],
  },
];

function maker() {
  const c = Platform.constants as { Brand?: string; Manufacturer?: string } | undefined;
  const brand = `${c?.Brand ?? ''} ${c?.Manufacturer ?? ''}`.toLowerCase();
  return MAKERS.find((m) => m.brands.some((b) => brand.includes(b))) ?? null;
}

async function loadTicks(): Promise<Partial<Record<SetupKey, boolean>>> {
  try {
    const raw = await AsyncStorage.getItem(TICKS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** The rider says this one is done (or not, to see it again). */
export async function tick(key: SetupKey, done = true): Promise<void> {
  if (key === 'battery') {
    await AsyncStorage.setItem(BATTERY_KEY, done ? '1' : '0').catch(() => {});
    return;
  }
  const ticks = await loadTicks();
  ticks[key] = done;
  await AsyncStorage.setItem(TICKS_KEY, JSON.stringify(ticks)).catch(() => {});
}

/** The checklist for this phone, each row with whether it is done. */
export async function checklist(): Promise<SetupItem[]> {
  if (Platform.OS !== 'android') return [];
  const [notif, location, ticks, battery] = await Promise.all([
    Notifications.getPermissionsAsync().then((p) => p.granted).catch(() => false),
    hasLocationPermission().catch(() => false),
    loadTicks(),
    AsyncStorage.getItem(BATTERY_KEY).then((v) => v === '1').catch(() => false),
  ]);
  const m = maker();
  const items: SetupItem[] = [
    {
      key: 'notifications',
      title: 'Notifications on',
      why: 'New jobs ring as notifications. Off, you can miss them.',
      done: notif,
      checked: true,
      button: 'Turn on',
    },
    {
      key: 'location',
      title: 'Location: "Allow all the time"',
      why: 'So the customer is told you are near, and the office sees you with the screen off.',
      steps: 'Permissions ▸ Location ▸ Allow all the time',
      done: location,
      checked: true,
      button: 'Open settings',
    },
    {
      key: 'battery',
      title: 'Battery: not restricted',
      why: 'So the phone does not stop the app while you wait for jobs.',
      steps: 'Find 369 Delivery Partner ▸ Don’t optimise / Unrestricted',
      done: battery,
      checked: false,
      button: 'Open battery settings',
    },
  ];
  // Android 14 and later ask for the call-style ring separately.
  if (Number(Platform.Version) >= 34) {
    items.push({
      key: 'fullScreen',
      title: 'Ring over the lock screen',
      why: 'A new job fills the screen like an incoming call, even when the phone is locked.',
      steps: 'Turn on "Allow full screen notifications"',
      done: !!ticks.fullScreen,
      checked: false,
      button: 'Open settings',
    });
  }
  items.push({
    key: 'dnd',
    title: 'Ring in Do Not Disturb',
    why: 'New jobs still ring when the phone is on silent or Do Not Disturb.',
    steps: 'Do Not Disturb access ▸ 369 Delivery Partner ▸ Allow',
    done: !!ticks.dnd,
    checked: false,
    button: 'Open settings',
  });
  if (m) {
    items.push({
      key: 'autostart',
      title: `${m.name}: keep the app running`,
      why: `${m.name} phones stop apps in the background unless they are allowed to run.`,
      steps: m.steps,
      done: !!ticks.autostart,
      checked: false,
      button: 'Open settings',
    });
  }
  return items;
}

/** How many of the checklist's rows are done, for the card on Home. */
export async function setupProgress(): Promise<{ done: number; total: number }> {
  const items = await checklist();
  return { done: items.filter((i) => i.done).length, total: items.length };
}

async function appSettings(): Promise<void> {
  await Linking.openSettings().catch(() => {});
}

async function intent(action: string, extra?: IntentLauncher.IntentLauncherParams): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync(action, extra);
    return true;
  } catch {
    return false;
  }
}

/** Take the rider to the settings page for one row. Falls back to the app's own settings. */
export async function openFor(key: SetupKey): Promise<void> {
  switch (key) {
    case 'notifications':
      if (!(await Notifications.requestPermissionsAsync().then((p) => p.granted).catch(() => false))) {
        const ok = await intent('android.settings.APP_NOTIFICATION_SETTINGS', {
          extra: { 'android.provider.extra.APP_PACKAGE': PACKAGE },
        });
        if (!ok) await appSettings();
      }
      return;
    case 'location':
      await appSettings();
      return;
    case 'battery':
      if (!(await intent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'))) await appSettings();
      return;
    case 'fullScreen':
      if (!(await intent('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT', { data: `package:${PACKAGE}` }))) {
        await appSettings();
      }
      return;
    case 'dnd':
      if (!(await intent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS'))) await appSettings();
      return;
    case 'autostart': {
      const m = maker();
      for (const s of m?.screens ?? []) {
        if (await intent('android.intent.action.MAIN', { packageName: s.packageName, className: s.className })) return;
      }
      await appSettings();
      return;
    }
  }
}
