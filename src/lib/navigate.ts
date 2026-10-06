import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { normalisePhone } from '../api/rest/client';
import { coords } from './format';

/**
 * Handing the rider over to a navigation app, and to WhatsApp.
 *
 * Coordinates when there are any worth using, the written address otherwise.
 * Live customer rows still carry no coordinates (Odoo geocodes nothing yet), but
 * a shop's do, and a pin beats an address a map app has to guess at — "Al
 * Khuwair, near the roundabout" is a search, not a destination.
 */

export type NavApp = 'google' | 'waze';

export const NAV_APPS: { key: NavApp; label: string }[] = [
  { key: 'google', label: 'Google Maps' },
  { key: 'waze', label: 'Waze' },
];

const KEY = 'd369.navApp';
let cached: NavApp | null = null;

/** The rider's choice from Profile. Google Maps until they pick. */
export async function getNavApp(): Promise<NavApp> {
  if (cached) return cached;
  try {
    const saved = await AsyncStorage.getItem(KEY);
    cached = saved === 'waze' ? 'waze' : 'google';
  } catch {
    cached = 'google';
  }
  return cached;
}

export async function setNavApp(app: NavApp): Promise<void> {
  cached = app;
  await AsyncStorage.setItem(KEY, app).catch(() => {});
}

export interface Destination {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  /**
   * Where the trip starts: the rider's position when the app has one. Google
   * Maps then opens with both ends filled in, not just the end.
   */
  origin?: { latitude: number; longitude: number } | null;
}

/**
 * Universal links rather than `waze://` or `google.navigation:`: they open the
 * app when it is installed and a web page offering it when not, and they need
 * no `<queries>` entry in the manifest to be allowed out.
 *
 * Google gets `dir_action=navigate`: with the start at the rider's position it
 * goes straight into turn-by-turn, and from anywhere else it shows the route
 * to look over. Waze links have no start point at all; Waze always navigates
 * from where the phone is.
 */
export function navigationUrl(app: NavApp, dest: Destination): string | null {
  const c = coords(dest.latitude, dest.longitude);
  const address = dest.address?.trim();

  if (app === 'waze') {
    if (c) return `https://waze.com/ul?ll=${c.latitude},${c.longitude}&navigate=yes`;
    if (address) return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
    return null;
  }

  const target = c ? `${c.latitude},${c.longitude}` : address;
  if (!target) return null;
  const from = coords(dest.origin?.latitude, dest.origin?.longitude);
  const origin = from ? `&origin=${from.latitude},${from.longitude}` : '';
  return (
    `https://www.google.com/maps/dir/?api=1${origin}` +
    `&destination=${encodeURIComponent(target)}&travelmode=driving&dir_action=navigate`
  );
}

/** False when there is nowhere to send them: no coordinates and no address. */
export async function openNavigation(dest: Destination): Promise<boolean> {
  const url = navigationUrl(await getNavApp(), dest);
  if (!url) return false;
  await Linking.openURL(url).catch(() => {});
  return true;
}

/**
 * A WhatsApp chat with this number, or null when it cannot be one.
 *
 * wa.me wants the full international number in digits. The orders arrive over
 * WhatsApp, so a customer's number is already in that form; a number too short
 * to carry a country code is refused rather than opened onto the wrong person.
 */
export function whatsappUrl(number: string | null | undefined, text?: string): string | null {
  const digits = normalisePhone(number ?? '');
  if (digits.length < 8) return null;
  // `text` arrives typed in the chat, ready to send: the quick replies and SOS.
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}

export function openWhatsApp(number: string | null | undefined, text?: string): void {
  const url = whatsappUrl(number, text);
  if (url) Linking.openURL(url).catch(() => {});
}
