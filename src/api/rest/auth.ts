import { getItem, removeItem, setItem } from '../../lib/storage';

/**
 * The rider's token from `auth/verify-code`.
 *
 * It goes on every call as `Authorization: Bearer …`, and `auth/refresh` trades
 * it for a new one when Odoo answers 401. Odoo keeps only a hash of it, one per
 * device (Delivery ▸ Configuration ▸ App Sessions), so this is the only copy.
 *
 * Kept apart from the server config on purpose: the config is not secret and is
 * shown on Connect, this is, and signing out removes it alone.
 */

const KEY = 'd369.auth';

export interface Tokens {
  access: string;
  /** Only if a server ever sends a separate one; the documented API does not. */
  refresh?: string;
}

/** `undefined` until storage has been read once. */
let cached: Tokens | null | undefined;

export async function getTokens(): Promise<Tokens | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Tokens>) : null;
    cached = saved?.access ? { access: saved.access, refresh: saved.refresh } : null;
  } catch {
    // Unreadable is the same as signed out: Connect, not a crash.
    cached = null;
  }
  return cached;
}

export async function saveTokens(tokens: Tokens): Promise<void> {
  cached = tokens;
  await setItem(KEY, JSON.stringify(tokens));
}

export async function clearTokens(): Promise<void> {
  cached = null;
  await removeItem(KEY);
}
