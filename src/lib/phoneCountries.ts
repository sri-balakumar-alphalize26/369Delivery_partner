/**
 * Mobile number rules for the sign-in screen, one per country.
 *
 * The rider types the number without its dialling code; the code sits in front
 * as a chip, opened on the chosen database's company country (see
 * `databaseCountry`). Odoo's rider record still holds the whole thing, code
 * first, so the two are joined before anything is sent or saved.
 *
 * A country Odoo names that is not listed here still works: `fromServer`
 * builds a loose rule from its dialling code, so no rider is ever locked out
 * by a missing entry.
 */

export type PhoneCountry = {
  /** ISO code, as Odoo's `res.country.code`: 'IN'. */
  iso: string;
  name: string;
  /** Dialling code, digits only: '91'. */
  dial: string;
  /** Allowed lengths of the number without the code. */
  minLen: number;
  maxLen: number;
  /** First digits a mobile number may start with; empty means any. */
  starts: string;
  flag: string;
};

/** India first (the default), then the Gulf, then the rest by name. */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: 'IN', name: 'India', dial: '91', minLen: 10, maxLen: 10, starts: '6789', flag: '🇮🇳' },
  { iso: 'AE', name: 'UAE', dial: '971', minLen: 9, maxLen: 9, starts: '5', flag: '🇦🇪' },
  { iso: 'OM', name: 'Oman', dial: '968', minLen: 8, maxLen: 8, starts: '79', flag: '🇴🇲' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', minLen: 9, maxLen: 9, starts: '5', flag: '🇸🇦' },
  { iso: 'QA', name: 'Qatar', dial: '974', minLen: 8, maxLen: 8, starts: '3567', flag: '🇶🇦' },
  { iso: 'KW', name: 'Kuwait', dial: '965', minLen: 8, maxLen: 8, starts: '569', flag: '🇰🇼' },
  { iso: 'BH', name: 'Bahrain', dial: '973', minLen: 8, maxLen: 8, starts: '36', flag: '🇧🇭' },
  { iso: 'BD', name: 'Bangladesh', dial: '880', minLen: 10, maxLen: 10, starts: '1', flag: '🇧🇩' },
  { iso: 'EG', name: 'Egypt', dial: '20', minLen: 10, maxLen: 10, starts: '1', flag: '🇪🇬' },
  { iso: 'MY', name: 'Malaysia', dial: '60', minLen: 9, maxLen: 10, starts: '1', flag: '🇲🇾' },
  { iso: 'NP', name: 'Nepal', dial: '977', minLen: 10, maxLen: 10, starts: '9', flag: '🇳🇵' },
  { iso: 'PK', name: 'Pakistan', dial: '92', minLen: 10, maxLen: 10, starts: '3', flag: '🇵🇰' },
  { iso: 'PH', name: 'Philippines', dial: '63', minLen: 10, maxLen: 10, starts: '9', flag: '🇵🇭' },
  { iso: 'SG', name: 'Singapore', dial: '65', minLen: 8, maxLen: 8, starts: '89', flag: '🇸🇬' },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', minLen: 9, maxLen: 9, starts: '7', flag: '🇱🇰' },
  { iso: 'GB', name: 'United Kingdom', dial: '44', minLen: 10, maxLen: 10, starts: '7', flag: '🇬🇧' },
  { iso: 'US', name: 'United States', dial: '1', minLen: 10, maxLen: 10, starts: '23456789', flag: '🇺🇸' },
];

export const DEFAULT_COUNTRY = PHONE_COUNTRIES[0];

/** A flag from an ISO code, for a country that is not in the list. */
function flagOf(iso: string): string {
  return /^[A-Z]{2}$/.test(iso)
    ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '🌐';
}

/** The country Odoo named, from the list when known, else a loose rule. */
export function fromServer(iso: string | null, phoneCode: number | null): PhoneCountry | null {
  const code = (iso ?? '').toUpperCase();
  const known = PHONE_COUNTRIES.find((c) => c.iso === code);
  if (known) return known;
  if (!code || !phoneCode) return null;
  return { iso: code, name: code, dial: String(phoneCode), minLen: 6, maxLen: 12, starts: '', flag: flagOf(code) };
}

/**
 * A saved whole number ('917092090133') split back into its country and the
 * rest. The longest matching code wins, so 971 is never read as 97 + 1.
 * A number no listed code fits stays whole under the default country.
 */
export function splitSaved(digits: string): { country: PhoneCountry; local: string } {
  const match = [...PHONE_COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial) && digits.length > c.dial.length);
  return match
    ? { country: match, local: digits.slice(match.dial.length) }
    : { country: DEFAULT_COUNTRY, local: digits };
}

/** Typed text cut down to what the country allows: digits, its length, a right first digit. */
export function cleanLocal(country: PhoneCountry, raw: string): string {
  let digits = raw.replace(/\D/g, '');
  // A pasted whole number: drop its code (or a leading 0) rather than refuse it.
  if (digits.length > country.maxLen && digits.startsWith(country.dial)) {
    digits = digits.slice(country.dial.length);
  }
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits && country.starts && !country.starts.includes(digits[0])) return '';
  return digits.slice(0, country.maxLen);
}

/** What the rule is, in words, for the hint and the error. */
export function ruleText(country: PhoneCountry): string {
  const len =
    country.minLen === country.maxLen
      ? `${country.maxLen} digits`
      : `${country.minLen} to ${country.maxLen} digits`;
  if (!country.starts) return `${country.name} mobile numbers are ${len}.`;
  const firsts = [...country.starts];
  const list = firsts.length === 1 ? firsts[0] : `${firsts.slice(0, -1).join(', ')} or ${firsts[firsts.length - 1]}`;
  return `${country.name} mobile numbers are ${len} and start with ${list}.`;
}

/** Null when the number fits the country, else what is wrong with it. */
export function checkLocal(country: PhoneCountry, local: string): string | null {
  if (!local) return 'Enter your WhatsApp number.';
  const ok =
    /^\d+$/.test(local) &&
    local.length >= country.minLen &&
    local.length <= country.maxLen &&
    (!country.starts || country.starts.includes(local[0]));
  return ok ? null : ruleText(country);
}
