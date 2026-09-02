/**
 * Money and time formatting.
 *
 * Two open questions with the Odoo team are parked here rather than guessed at
 * in a dozen screens.
 */

/**
 * OMR is a three-decimal currency (1 rial = 1000 baisa), so `12.5` means
 * 12.500 and must not be rendered as `12.50`.
 *
 * NOTE: the contract's example shows `"amount_to_collect": 1000.0` for a single
 * demo order, which would be an implausible 1000 rial. Whether that field is
 * rial or baisa is still unconfirmed. This formats it as given — as rial — which
 * is the reading that matches the `currency` field. Revisit once answered.
 */
const DECIMALS: Record<string, number> = {
  OMR: 3,
  KWD: 3,
  BHD: 3,
  INR: 2,
  USD: 2,
};

export function money(amount: number, currency = 'OMR'): string {
  const dp = DECIMALS[currency] ?? 2;
  return `${currency} ${amount.toFixed(dp)}`;
}

/**
 * The contract's timestamps carry no timezone offset and the Odoo team have not
 * confirmed the zone, so parsing them as local time would silently shift them.
 * Until that is answered we reformat the string without converting it.
 */
export function promisedAt(raw: string | undefined): string {
  if (!raw) return '';
  const [date, time] = raw.split('T');
  if (!time) return raw;
  return `${date} · ${time.slice(0, 5)}`;
}
