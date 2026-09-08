/**
 * "Glass Light" design tokens — frosted translucent cards over a soft
 * blue-purple-orange gradient mesh.
 *
 * Ported from the template drop's `theme.js`. This replaces the Bold Cards and
 * Big Type token sets; see git history for those.
 */

export const glass = {
  // Navy and orange house palette, from the UI refresh. `indigo` keeps its
  // token name so every call site still compiles, but it resolves to the navy
  // primary now — the old #3730A3 read as a purple app rather than a delivery
  // one, and the soft tints below are most of why the refresh looks calmer.
  ink: '#1B2A4A',
  inkSoft: '#6B7280',
  inkFaint: '#9AA1B1',
  indigo: '#1B2A4A',
  orange: '#F26B1D',
  orangeSoft: '#FFF1E8',
  orangeLine: '#F9D3BC',
  green: '#1E8E4E',
  greenSoft: '#E8F5EE',
  red: '#D94141',
  redSoft: '#FDEBEB',
  white: '#FFFFFF',

  /** The mesh's own stops, kept for anything that needs to blend into it. */
  meshTop: '#DCEBFF',
  meshMid: '#E9E4FF',
  meshBottom: '#FFE8DC',

  /**
   * Card surfaces — deliberately WHITE, not the template's translucent glass.
   *
   * The template specifies rgba(255,255,255,0.55) over the coloured mesh, and
   * its own mockup measures out at #E7EDFF / #F0F1FF / #F3F3FF inside the cards.
   * That is a lavender tint by design, and on a real screen it reads as grey
   * panels with a grey rim. Solid white was asked for instead, so this is an
   * intentional departure — not drift from reference-screens/.
   */
  bg: '#FFFFFF',
  /** A hairline edge, not the rim the translucent border produced. */
  border: '#E6E8EF',
  /**
   * Chips and tiles. Sampled from the template's own stat chip: they sit ON a
   * white card now, so 50% white over white would make them vanish.
   */
  fill: '#EEF0F7',
  fillStrong: '#FFFFFF',
  fillLight: '#F7F8FB',

  btnDark: '#1B2A4A',
  btnGhost: '#FFFFFF',
  divider: '#E6E8EF',
  dividerDashed: '#D6D9E3',
} as const;

export const poppins = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  extrabold: 'Poppins_800ExtraBold',
} as const;

/**
 * The drop expresses weight as `fontWeight`, which React Native ignores for a
 * custom family — the face has to be named. These map its scale onto the loaded
 * Poppins faces.
 */
export const gtype = {
  hero: { fontFamily: poppins.bold, fontSize: 26 },
  amount: { fontFamily: poppins.bold, fontSize: 36, letterSpacing: -1 },
  amountLg: { fontFamily: poppins.bold, fontSize: 40, letterSpacing: -1.5 },
  title: { fontFamily: poppins.bold, fontSize: 19 },
  subtitle: { fontFamily: poppins.bold, fontSize: 16 },
  body: { fontFamily: poppins.medium, fontSize: 14 },
  bodyStrong: { fontFamily: poppins.semibold, fontSize: 15 },
  label: { fontFamily: poppins.bold, fontSize: 12, letterSpacing: 0.4 },
  caption: { fontFamily: poppins.medium, fontSize: 12 },
  button: { fontFamily: poppins.semibold, fontSize: 15 },
} as const;

export const gradius = {
  card: 22,
  chip: 14,
  button: 18,
  pill: 24,
  avatar: 28,
} as const;

export const gspace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/**
 * Where a phone layout stops making sense and a tablet one starts.
 *
 * This replaces a fixed 560dp centred column, which was the wrong fix for a
 * stretched tablet: it traded a spread-out layout for a wasted one, leaving
 * broad empty margins down both sides. A screen should use the width it has —
 * a phone gets one full-width column, a tablet gets two.
 *
 * 768 rather than a number of our own: it is the line React Navigation already
 * uses to decide the tab bar's layout, so the app changes shape once rather
 * than twice at slightly different widths.
 */
export const TABLET_MIN_WIDTH = 768;

/**
 * How wide a column of text may get.
 *
 * A map wants the whole screen; a sentence does not. Unbounded on a 1200px
 * tablet an item name and its quantity ended up a metre apart. Only binds above
 * this width, so a phone is untouched.
 */
export const CONTENT_MAX_W = 720;

export const gshadow = {
  glass: {
    shadowColor: '#1F294A',
    // Softened from the template's 0.08 / elevation 3. Android draws elevation
    // as a grey drop shadow, and around a white card on a pale mesh that halo
    // was a large part of what read as a grey border.
    shadowOpacity: 0.05,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
} as const;

/**
 * Every state the order machine can emit.
 *
 * The drop lists eight; the contract's `DeliveryStatus` has more — `dispatched`,
 * `returned` and `cancelled` are all reachable. Shipping only the drop's eight
 * would leave the badge blank on a returned or cancelled job, so the missing
 * states are filled in from the same palette.
 */
export type GlassBarState =
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
  | 'cancelled'
  | 'failed';

/**
 * Soft tints rather than solid blocks, and shorter labels.
 *
 * Every state used to be a saturated fill with white text, so a list of jobs
 * was a column of shouting badges and none of them meant more than any other.
 * Only the two that genuinely want attention keep a strong colour — a new
 * offer, and a delivery in progress. The rest sit back as grey chips.
 *
 * Labels are cut to fit a chip: "GO TO THE SHOP" wrapped, "GO TO SHOP" does not.
 */
export const glassBand: Record<GlassBarState, { bg: string; fg: string; label: string }> = {
  disconnected: { bg: glass.fill, fg: glass.inkSoft, label: 'NOT CONNECTED' },
  idle: { bg: glass.fill, fg: glass.ink, label: 'NO JOBS' },
  offered: { bg: glass.orange, fg: glass.white, label: 'NEW JOB' },
  accepted: { bg: glass.fill, fg: glass.ink, label: 'GO TO SHOP' },
  picked: { bg: glass.fill, fg: glass.ink, label: 'COLLECTED' },
  dispatched: { bg: glass.fill, fg: glass.ink, label: 'LEFT SHOP' },
  out_for_delivery: { bg: glass.greenSoft, fg: glass.green, label: 'DELIVERING' },
  delivered: { bg: glass.greenSoft, fg: glass.green, label: 'DELIVERED' },
  returning: { bg: glass.redSoft, fg: glass.red, label: 'RETURNING' },
  returned: { bg: glass.fill, fg: glass.inkSoft, label: 'RETURNED' },
  cancelled: { bg: glass.fill, fg: glass.inkSoft, label: 'CANCELLED' },
  failed: { bg: glass.redSoft, fg: glass.red, label: 'FAILED' },
};
