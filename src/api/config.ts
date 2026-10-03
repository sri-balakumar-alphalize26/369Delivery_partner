import { getItem, setItem } from '../lib/storage';
import { normaliseServer as normalise, resolveServer } from './serverConfig';
import { ServerConfig } from './types';

/**
 * Where the app points, and who it says it is.
 *
 * The Odoo test host is a Cloudflare quick tunnel whose name changes every time
 * it restarts, so the address CANNOT be baked in — that would mean a rebuild and
 * a reinstall each time it bounces. A saved value therefore beats the build-time
 * default, and is edited on the Connect screen.
 *
 * Nothing here is secret any more — the password is never stored, and the
 * session lives in the phone's cookie jar — but SecureStore costs nothing and
 * keeps the door shut should a credential ever come back.
 */

const KEY = 'd369.server';

/**
 * Set by the `production` build profile in eas.json. The server, database and
 * support number are then the build's, not the rider's: Connect shows only
 * the WhatsApp sign-in, and nothing saved on the phone can point it elsewhere
 * (see `resolveServer`).
 */
export const SERVER_LOCKED = process.env.EXPO_PUBLIC_LOCK_SERVER === '1';

const FROM_ENV: ServerConfig = {
  url: process.env.EXPO_PUBLIC_API_URL ?? '',
  db: process.env.EXPO_PUBLIC_ODOO_DB ?? '',
  login: '',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  orsKey: process.env.EXPO_PUBLIC_ORS_KEY ?? '',
  // Demo data until someone signs in to a real server, so a fresh install is
  // never a dead screen — except in a locked build, which riders install.
  useMock: !SERVER_LOCKED && process.env.EXPO_PUBLIC_API_MODE !== 'real',
};

let cached: ServerConfig | null = null;

export async function getServer(): Promise<ServerConfig> {
  if (cached) return cached;

  try {
    const raw = await getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ServerConfig>;
      cached = resolveServer(FROM_ENV, saved, SERVER_LOCKED);
      return cached;
    }
  } catch {
    // Corrupt or unreadable — fall back rather than trapping the rider.
  }

  cached = resolveServer(FROM_ENV, null, SERVER_LOCKED);
  return cached;
}

export async function saveServer(cfg: ServerConfig): Promise<ServerConfig> {
  const next = normalise(cfg);
  cached = next;
  await setItem(KEY, JSON.stringify(next));
  return next;
}

/** Synchronous read for code paths that cannot await. May be stale before first load. */
export function peekServer(): ServerConfig {
  return cached ?? normalise(FROM_ENV);
}

export const ENV_DEFAULTS = normalise(FROM_ENV);
