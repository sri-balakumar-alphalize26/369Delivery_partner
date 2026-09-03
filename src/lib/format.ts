import { Currency } from '../api/types';

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
