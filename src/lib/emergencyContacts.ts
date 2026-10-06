import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The rider's emergency contacts, for SOS: up to two people (family, a friend)
 * who get a WhatsApp with the rider's location when SOS is held.
 *
 * Kept on this phone only. They go to the server with an SOS, so the office can
 * call them too, and nowhere else.
 */

export interface EmergencyContact {
  name: string;
  /** With the country code, digits as typed. */
  phone: string;
}

export const MAX_CONTACTS = 2;
const KEY = 'd369.emergencyContacts';

export async function getContacts(): Promise<EmergencyContact[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as EmergencyContact[]) : [];
    return list.filter((c) => c && c.phone).slice(0, MAX_CONTACTS);
  } catch {
    return [];
  }
}

export async function saveContacts(list: EmergencyContact[]): Promise<void> {
  const clean = list
    .map((c) => ({ name: c.name.trim(), phone: c.phone.trim() }))
    .filter((c) => c.phone.replace(/\D/g, '').length >= 8)
    .slice(0, MAX_CONTACTS);
  await AsyncStorage.setItem(KEY, JSON.stringify(clean)).catch(() => {});
}
