import { Currency, Shop } from '../api/types';

/**
 * Money and time formatting.
 *
 * Both rules here come straight from the contract's "two conventions worth
 * reading once", and both were previously guessed at because the contract had
 * not been read: money was rounded from a local table, and timestamps were
 * shown as the raw UTC string.
 */

/**
 * NOTE: the contract's example shows `"amount_to_collect": 1000.0` for a single
 * demo order, which would be an implausible 1000 rial. Whether that field is
 * rial or baisa is still unconfirmed — the artifact does not resolve it. This
 * formats it as given, as rial, which is the reading that matches `currency`.
 */
const FALLBACK_DECIMALS = 2;

/**
 * "Format using `currency.decimals` — OMR is 3, most currencies 2, some 0.
 * Do not hardcode two."
 *
 * The code is shown rather than `symbol`: the symbol is Arabic script ("ر.ع.")
 * and would break the tabular alignment of a 56px number. `symbol` is on the
 * type and available if that changes.
 */
export function money(amount: number, currency?: Currency): string {
  const dp =
    typeof currency?.decimals === 'number' ? currency.decimals : FALLBACK_DECIMALS;
  const code = currency?.code ?? '';
  return `${code} ${amount.toFixed(dp)}`.trim();
}

/**
 * Every datetime in the contract is UTC and ends in `Z`. Display it in the
 * rider's shop timezone, which the API returns alongside — never in the
 * phone's own zone, which may not match the server's.
 */
export function promisedAt(raw: string | undefined, timeZone?: string): string {
  if (!raw) return '';

  const parsed = new Date(asUtc(raw));
  if (Number.isNaN(parsed.getTime())) return raw;

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(parsed)
      .replace(',', ' ·');
  } catch {
    // Hermes ships ICU, but an unknown zone name still throws. A time shown in
    // the wrong zone is a smaller failure than a job screen that will not render.
    return raw;
  }
}

/**
 * The contract states every datetime ends in `Z`, but its own `delivered_at`
 * example ("2026-09-02T17:35:00") omits it. Treat a naked timestamp as UTC,
 * per the stated rule, rather than letting the runtime read it as local.
 */
function asUtc(raw: string): string {
  return /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
}

/**
 * The shop's name, whichever shape it arrives in.
 *
 * `shop` was a bare string until the backend shipped the shop object; the live
 * server now sends `{ id, name, image_url, ... }`. Rendering that straight into
 * JSX crashes React Native with "Objects are not valid as a React child" — the
 * same failure the currency object caused. Both shapes resolve here, so no
 * screen has to know which one it was handed.
 */
export function shopName(shop: Shop | string | undefined): string {
  if (!shop) return '';
  return typeof shop === 'string' ? shop : (shop.name ?? '');
}

/**
 * Coordinates, or null when there are none worth using.
 *
 * res-test1 returns `null` today and returned `0.0` before that — and 0,0 is a
 * real place in the Atlantic, so a map would happily drop a pin there. Both
 * mean "never geocoded", and the caller should fall back to the address.
 */
export function coords(
  lat: number | null | undefined,
  lng: number | null | undefined
): { latitude: number; longitude: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * Just the clock time, for a step that has already happened.
 *
 * `promisedAt` carries the date because a promise can fall on another day. A
 * timeline step cannot — it is always today's job — and the date there is
 * noise between four dots. Same zone rule as everything else in this file:
 * the shop's, never the phone's.
 */
export function timeOnly(raw: string | undefined, timeZone?: string): string {
  if (!raw) return '';

  const parsed = new Date(asUtc(raw));
  if (Number.isNaN(parsed.getTime())) return '';

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(parsed);
  } catch {
    // As above: an unknown zone throws even with ICU present, and a missing
    // time under a dot is a smaller failure than a screen that will not render.
    return '';
  }
}
