/**
 * Design tokens — "Big Type + Status Colour".
 *
 * Rules this file exists to enforce:
 *   - No cards, no shadows, no borders, no gradients. Separation is whitespace
 *     and hairlines only.
 *   - Hierarchy comes from type SIZE, never from boxes.
 *   - Exactly one piece of colour on screen: the status bar at the top.
 *
 * Brand colours are sampled from the supplied 369 Delivery Partner artwork.
 */

export const color = {
  bg: '#FFFFFF',
  ink: '#0A0A0A',
  inkSoft: '#6B7280',
  hairline: '#E5E7EB',
  white: '#FFFFFF',

  /** brand — sampled from the logo */
  brand: '#0042B3',
  brandTint: '#0058D2',
  orange: '#FE5901',

  green: '#16A34A',
  red: '#B3241A',
  grey: '#6B7280',
  near: '#111827',
} as const;

/**
 * Every state the top bar can show — one per delivery status from the contract,
 * plus two for when there is no job in hand.
 *
 * The two brand colours carry the two states that matter most, so the app reads
 * as ours rather than as a template.
 *
 * Contrast: brand orange only reaches 3.4:1 against white, so the new-job bar
 * uses near-black text. Everything else is white on a dark enough ground.
 */
export type BarState =
  | 'disconnected'
  | 'idle'
  | 'offered'
  | 'accepted'
  | 'picked'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered'
  | 'returning'
  | 'returned'
  | 'cancelled';

export const statusBar: Record<BarState, { bg: string; fg: string; label: string }> = {
  disconnected: { bg: color.grey, fg: color.white, label: 'NOT CONNECTED' },
  idle: { bg: color.near, fg: color.white, label: 'NO JOBS RIGHT NOW' },
  offered: { bg: color.orange, fg: color.ink, label: 'NEW JOB' },
  accepted: { bg: color.brand, fg: color.white, label: 'GO TO THE SHOP' },
  picked: { bg: color.brandTint, fg: color.white, label: 'PARCEL COLLECTED' },
  dispatched: { bg: color.brandTint, fg: color.white, label: 'LEFT THE SHOP' },
  out_for_delivery: { bg: color.green, fg: color.white, label: 'DELIVERING' },
  delivered: { bg: color.green, fg: color.white, label: 'DELIVERED' },
  returning: { bg: color.red, fg: color.white, label: 'RETURNING TO SHOP' },
  returned: { bg: color.grey, fg: color.white, label: 'RETURNED' },
  cancelled: { bg: color.grey, fg: color.white, label: 'CANCELLED' },
};

export const font = {
  regular: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
} as const;

/** Tabular figures so counters and money never jitter as digits change. */
export const tabular = { fontVariant: ['tabular-nums' as const] };

export const fontJakarta = {
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const type = {
  hero: { fontFamily: font.bold, fontSize: 88, lineHeight: 90, letterSpacing: -3.5 },
  big: { fontFamily: font.bold, fontSize: 56, lineHeight: 58, letterSpacing: -2 },
  mid: { fontFamily: font.bold, fontSize: 38, lineHeight: 42, letterSpacing: -1.2 },
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.6 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 23 },
  label: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
  },
  button: { fontFamily: font.bold, fontSize: 18, letterSpacing: 0.3 },

  /* Bold Cards variants. Prefixed so they cannot collide with the Big Type
     names above, which other screens still use. */
  cardAmount: { fontFamily: fontJakarta.extrabold, fontSize: 36, letterSpacing: -1 },
  cardStat: { fontFamily: fontJakarta.extrabold, fontSize: 22, letterSpacing: -0.5 },
  cardTitle: { fontFamily: fontJakarta.extrabold, fontSize: 19 },
  cardBody: { fontFamily: fontJakarta.semibold, fontSize: 15, lineHeight: 21 },
  cardLabel: { fontFamily: fontJakarta.bold, fontSize: 12, letterSpacing: 0.4 },
  cardCaption: { fontFamily: fontJakarta.semibold, fontSize: 12, lineHeight: 17 },
  cardButton: { fontFamily: fontJakarta.bold, fontSize: 15 },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  huge: 40,
  gutter: 22,
} as const;

/** One radius, used sparingly. Buttons only. */
export const radius = 8;

/** 64px is the minimum comfortable target for a gloved thumb on a bike. */
export const controlHeight = 64;

/* ------------------------------------------------------------------------- *
 * "Bold Cards" — the second design system.
 *
 * Added alongside the Big Type tokens above, never replacing them: the four
 * screens not yet rebuilt still reference `color.bg`, `type.title`, `radius`
 * and `controlHeight`, and repointing those would break all of them at once.
 * As each screen moves over it stops using the old names; when none are left,
 * the block above can go.
 *
 * Values are ported verbatim from the template's theme.js.
 * ------------------------------------------------------------------------- */

export const cardColor = {
  /** Screen ground. Deliberately NOT color.bg, which is white and shared. */
  canvas: '#F4F6FA',
  card: '#FFFFFF',
  /** The template's blue. Slightly lighter than the logo-sampled color.brand. */
  brand: '#0B3FB5',
  brandDark: '#0F172A',
  orange: '#FE5901',
  green: '#16A34A',
  red: '#B91C1C',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textFaint: '#94A3B8',
  border: '#E2E8F0',
  divider: '#EEF2F7',
  chipBg: '#F4F6FA',
  onlineGreen: '#22C55E',
} as const;


export const cardRadius = {
  card: 20,
  chip: 14,
  button: 16,
  pill: 24,
  avatar: 23,
  /** The header's rounded lower corners. */
  header: 28,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  floating: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;

/** 54px per the template, against Big Type's 64. */
export const cardControlHeight = 54;
