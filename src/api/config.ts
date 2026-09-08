import { getItem, removeItem, setItem } from '../lib/storage';
import { ServerConfig } from './types';

/**
 * Where the app points, and who it says it is.
 *
 * The Odoo test host is a Cloudflare quick tunnel whose name changes every time
 * it restarts, so the address CANNOT be baked in — that would mean a rebuild and
 * a reinstall each time it bounces. A saved value therefore beats the build-time
 * default, and is edited on the Connect screen.
 *
 * The token is a credential, so all of this lives in SecureStore rather than
 * AsyncStorage.
 */

const KEY = 'd369.server';

const FROM_ENV: ServerConfig = {
  url: process.env.EXPO_PUBLIC_API_URL ?? '',
  db: process.env.EXPO_PUBLIC_ODOO_DB ?? '',
  token: '',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  // Demo data until someone pastes a real token, so a fresh install is never
  // a dead screen.
  useMock: process.env.EXPO_PUBLIC_API_MODE !== 'real',
};

let cached: ServerConfig | null = null;

function normalise(cfg: ServerConfig): ServerConfig {
  return {
    // A trailing slash would produce `//api/delivery/...` and a confusing 404.
    url: cfg.url.trim().replace(/\/+$/, ''),
    db: cfg.db.trim(),
    token: cfg.token.trim(),
    // Optional and absent from every config saved before it existed.
    supportPhone: cfg.supportPhone?.trim() ?? '',
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

export async function clearServer(): Promise<void> {
  cached = null;
  await removeItem(KEY);
}

/** Synchronous read for code paths that cannot await. May be stale before first load. */
export function peekServer(): ServerConfig {
  return cached ?? normalise(FROM_ENV);
}

export const ENV_DEFAULTS = normalise(FROM_ENV);
