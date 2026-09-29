import { getItem, setItem } from '../lib/storage';
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

const FROM_ENV: ServerConfig = {
  url: process.env.EXPO_PUBLIC_API_URL ?? '',
  db: process.env.EXPO_PUBLIC_ODOO_DB ?? '',
  login: '',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  orsKey: process.env.EXPO_PUBLIC_ORS_KEY ?? '',
  // Demo data until someone signs in to a real server, so a fresh install is
  // never a dead screen.
  useMock: process.env.EXPO_PUBLIC_API_MODE !== 'real',
};

let cached: ServerConfig | null = null;

function normalise(cfg: ServerConfig): ServerConfig {
  return {
    // A trailing slash would produce `//api/delivery/...` and a confusing 404.
    url: cfg.url.trim().replace(/\/+$/, ''),
    db: cfg.db.trim(),
    // Absent from a config saved when the app still pasted a token.
    login: cfg.login?.trim() ?? '',
    // Optional and absent from every config saved before it existed.
    supportPhone: cfg.supportPhone?.trim() ?? '',
    orsKey: cfg.orsKey?.trim() ?? '',
    useMock: cfg.useMock,
  };
}

export async function getServer(): Promise<ServerConfig> {
  if (cached) return cached;

  try {
    const raw = await getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ServerConfig>;
      cached = normalise({ ...FROM_ENV, ...saved });
      return cached;
    }
  } catch {
    // Corrupt or unreadable — fall back rather than trapping the rider.
  }

  cached = normalise(FROM_ENV);
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
