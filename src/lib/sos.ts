import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';
import { api } from '../api/endpoints';
import { Fix, SosReport } from '../api/types';
import { currentFix } from '../location/currentFix';
import { EmergencyContact, getContacts } from './emergencyContacts';

/**
 * SOS: the rider held the shield's button for three seconds.
 *
 * The office is told through `POST /api/delivery/sos`. With no signal, or on a
 * server that does not have the route yet, the report is kept and sent again
 * every 20 seconds for ten minutes, so a rider in a dead spot is still heard
 * once a bar comes back. Whatever the office's answer, the sheet goes on to
 * offer WhatsApp to the emergency contacts and the emergency number: those work
 * without our server.
 */

export type OfficeState = 'sent' | 'retrying';

export interface SosOutcome {
  office: OfficeState;
  fix: Fix | null;
  contacts: EmergencyContact[];
}

const PENDING_KEY = 'd369.sosPending';
const RETRY_MS = 20_000;
const GIVE_UP_MS = 10 * 60_000;
let retry: ReturnType<typeof setInterval> | null = null;

async function trySend(report: SosReport): Promise<boolean> {
  try {
    await api.sos(report);
    return true;
  } catch {
    return false;
  }
}

function keepTrying(report: SosReport): void {
  void AsyncStorage.setItem(PENDING_KEY, JSON.stringify(report)).catch(() => {});
  if (retry) clearInterval(retry);
  const started = Date.now();
  retry = setInterval(async () => {
    if (Date.now() - started > GIVE_UP_MS) {
      if (retry) clearInterval(retry);
      retry = null;
      return;
    }
    if (await trySend(report)) {
      if (retry) clearInterval(retry);
      retry = null;
      await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
    }
  }, RETRY_MS);
}

export async function sendSos(orderId?: number): Promise<SosOutcome> {
  Vibration.vibrate([0, 600, 200, 600]);
  const [fix, contacts] = await Promise.all([currentFix(), getContacts()]);
  const report: SosReport = {
    at: new Date().toISOString(),
    ...(fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : {}),
    ...(orderId ? { delivery_order_id: orderId } : {}),
    contacts,
  };
  const sent = await trySend(report);
  if (!sent) keepTrying(report);
  return { office: sent ? 'sent' : 'retrying', fix, contacts };
}

/** A map link anyone can open from WhatsApp. */
export function mapLink(fix: Fix | null): string | null {
  return fix ? `https://maps.google.com/?q=${fix.latitude.toFixed(6)},${fix.longitude.toFixed(6)}` : null;
}

/** The message each emergency contact gets, ready to send. */
export function sosMessage(riderName: string, fix: Fix | null, orderRef?: string): string {
  const where = mapLink(fix);
  return [
    `SOS from ${riderName} (369 Delivery). I need help.`,
    where ? `My location: ${where}` : 'My location could not be found.',
    orderRef ? `Job ${orderRef}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The emergency number for where the company is, from its time zone. */
export function emergencyNumber(timezone?: string): string {
  if (timezone === 'Asia/Muscat') return '9999';
  if (timezone === 'Asia/Kolkata' || timezone === 'Asia/Calcutta') return '112';
  if (timezone === 'Asia/Dubai') return '999';
  return '112';
}
