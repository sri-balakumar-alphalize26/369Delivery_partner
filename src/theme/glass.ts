/**
 * "Forest" design tokens — deep green bands, lime buttons, white cards with a
 * visible outline on a flat pale ground.
 *
 * Chosen for sunlight: a rider reads this at arm's length on a handlebar mount,
 * and the Glass Light look before it (soft mesh, hairline borders, faint greys)
 * washed out in glare. Nothing here depends on a shadow or a subtle tint, and
 * colours that must be told apart also differ in brightness.
 *
 * The token names are the Glass Light ones, kept so the thirty-odd files that
 * import them needed no edit. Read them by role, not by name: `indigo` is the
 * deep green, `orange` is the money colour, the `mesh*` stops are one flat
 * ground. See git history for the Glass Light values.
 */

export const glass = {
  ink: '#0B1F17',
  // One step darker than the template's mockup: muted text is the first thing
  // glare takes away.
  inkSoft: '#3F574C',
  inkFaint: '#5F7A6E',
  /** The strong neutral: dark buttons, progress, focus, the shop's pin. */
  indigo: '#0F3D2E',
  /**
   * Money and "look here". Not the button colour any more — that is `accent` —
   * so it only has to read as text on white, and as a line on the map.
   */
  orange: '#C2410C',
  orangeSoft: '#FFF4E5',
  orangeLine: '#F5C38A',
  green: '#166534',
  greenSoft: '#DCFCE7',
  red: '#B91C1C',
  redSoft: '#FEE2E2',
  white: '#FFFFFF',

  /**
   * The one thing to press. Lime is only ever a FILL, with `accentInk` on it;
   * as text on white it disappears, which is what `accentText` is for.
   */
  accent: '#A3E635',
  accentInk: '#04140C',
  accentLine: '#84CC16',
  accentText: '#166534',
  accentSoft: '#ECFCCB',

  /** Header bands and the tab bar. */
  band: '#0F3D2E',
  bandInk: '#FFFFFF',
  bandSoft: '#BFD9CB',
  tabOn: '#C6F26B',
  tabOff: '#9DBFB0',

  /** One flat ground. Three names because three call sites predate it. */
  meshTop: '#F3F7F4',
  meshMid: '#F3F7F4',
  meshBottom: '#F3F7F4',

  bg: '#FFFFFF',
  /** Dark enough to still draw a card's edge when the shadows are gone. */
  border: '#A9C4B5',
  fill: '#EAF2EC',
  fillStrong: '#FFFFFF',
  fillLight: '#F3F7F4',

  btnDark: '#0F3D2E',
  btnGhost: '#FFFFFF',
  divider: '#CFE0D6',
  dividerDashed: '#A9C4B5',
} as const;

/**
 * Inter, one step heavier than each name says: thin strokes are the second
 * thing glare takes away, so "regular" is the 500 face and "bold" the 800.
 * Inter over Manrope (6 Oct 2026): its 0/O and 1/l are told apart at a
 * glance, which is what the codes and amounts at the door need.
 */
export const font = {
  regular: 'Inter_500Medium',
  medium: 'Inter_600SemiBold',
  semibold: 'Inter_700Bold',
  bold: 'Inter_800ExtraBold',
  extrabold: 'Inter_800ExtraBold',
} as const;

/** The name the faces were first exported under; a few files still use it. */
export const poppins = font;

/**
 * Weight has to be a named face: React Native ignores `fontWeight` for a
 * custom family.
 */
export const gtype = {
  hero: { fontFamily: font.bold, fontSize: 26 },
  amount: { fontFamily: font.bold, fontSize: 36, letterSpacing: -1 },
  amountLg: { fontFamily: font.bold, fontSize: 40, letterSpacing: -1.5 },
  title: { fontFamily: font.bold, fontSize: 19 },
  subtitle: { fontFamily: font.bold, fontSize: 16 },
  body: { fontFamily: font.medium, fontSize: 14 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 15 },
  label: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.4 },
  caption: { fontFamily: font.medium, fontSize: 12 },
  button: { fontFamily: font.semibold, fontSize: 15 },
} as const;

/** Squared off: a work tool, not a shopping app. */
export const gradius = {
  card: 12,
  chip: 6,
  button: 10,
  pill: 6,
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

/**
 * No shadow at all. A card's edge is its `border` now: a soft shadow is
 * invisible in sunlight, and the outline is not. The shape stays so call sites
 * that spread it keep compiling.
 */
export const gshadow = {
  glass: {
    shadowColor: '#000000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
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
  | 'awaiting_shop'
  | 'preparing'
  | 'ready'
  | 'to_assign'
  | 'offered'
  | 'accepted'
  | 'picked'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered'
  | 'returning'
  | 'returned'
  | 'cancelled'
  | 'failed'
  | 'handover_waiting'
  | 'released';

/**
 * Four kinds of badge, told apart by brightness as much as by colour, so they
 * still differ when glare has bleached the colour out:
 *
 *   lime        a new offer — the one that wants a tap
 *   deep green  the rider's own job in hand, before the road
 *   pale green  on the road, and done
 *   grey        waiting on somebody else
 *
 * Labels are cut to fit a chip: "GO TO THE SHOP" wrapped, "GO TO SHOP" does not.
 */
export const glassBand: Record<GlassBarState, { bg: string; fg: string; label: string }> = {
  disconnected: { bg: glass.fill, fg: glass.inkSoft, label: 'NOT CONNECTED' },
  idle: { bg: glass.fill, fg: glass.ink, label: 'NO JOBS' },
  // The shop's steps before the rider is called. Quiet on purpose: there is
  // nothing to do yet, only something coming.
  awaiting_shop: { bg: glass.fill, fg: glass.inkSoft, label: 'AT SHOP' },
  preparing: { bg: glass.fill, fg: glass.inkSoft, label: 'PACKING' },
  ready: { bg: glass.accentSoft, fg: glass.accentText, label: 'PACKED' },
  to_assign: { bg: glass.fill, fg: glass.inkSoft, label: 'WAITING' },
  offered: { bg: glass.accent, fg: glass.accentInk, label: 'NEW JOB' },
  accepted: { bg: glass.band, fg: glass.bandInk, label: 'GO TO SHOP' },
  picked: { bg: glass.band, fg: glass.bandInk, label: 'COLLECTED' },
  // The shop guide's names: "Collected by Rider", "Rider Near Customer".
  dispatched: { bg: glass.band, fg: glass.bandInk, label: 'COLLECTED' },
  out_for_delivery: { bg: glass.greenSoft, fg: glass.green, label: 'NEAR CUSTOMER' },
  delivered: { bg: glass.greenSoft, fg: glass.green, label: 'DELIVERED' },
  returning: { bg: glass.redSoft, fg: glass.red, label: 'RETURNING' },
  returned: { bg: glass.fill, fg: glass.inkSoft, label: 'RETURNED' },
  cancelled: { bg: glass.fill, fg: glass.inkSoft, label: 'CANCELLED' },
  failed: { bg: glass.redSoft, fg: glass.red, label: 'FAILED' },
  handover_waiting: { bg: glass.redSoft, fg: glass.red, label: 'HANDOVER' },
  released: { bg: glass.fill, fg: glass.inkSoft, label: 'REASSIGNED' },
};
