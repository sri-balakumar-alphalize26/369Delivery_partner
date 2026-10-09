import { WorkLine } from '../api/types';
import { useSession } from '../store/session';
import { glass } from './glass';

/**
 * The two sides of the app look different on purpose, so a hybrid agent
 * always knows which one they are on: Delivery is the "Forest" band and lime
 * it always was; Service is deep indigo with sky blue.
 *
 * Same roles as the `glass` tokens (band, band text, the soft band text, tab
 * colours, the one thing to press), so a screen swaps a palette rather than
 * learning new names. Only the band-coloured parts change - cards, text and
 * the ground stay the same on both sides.
 */
export interface WorkspacePalette {
  band: string;
  bandInk: string;
  bandSoft: string;
  tabOn: string;
  tabOff: string;
  /** The strong colour for buttons and progress on this side. */
  strong: string;
  /** A pale wash of the band, for a card that belongs to this side. */
  soft: string;
  /** The bright accent, as a fill, with `accentInk` on it. */
  accent: string;
  accentInk: string;
}

export const deliveryPalette: WorkspacePalette = {
  band: glass.band,
  bandInk: glass.bandInk,
  bandSoft: glass.bandSoft,
  tabOn: glass.tabOn,
  tabOff: glass.tabOff,
  strong: glass.indigo,
  soft: glass.fill,
  accent: glass.accent,
  accentInk: glass.accentInk,
};

export const servicePalette: WorkspacePalette = {
  band: '#1C2C5B',
  bandInk: '#FFFFFF',
  bandSoft: '#C3CCE8',
  tabOn: '#7DD3FC',
  tabOff: '#A3AFCF',
  strong: '#1C2C5B',
  soft: '#E6EAF7',
  accent: '#7DD3FC',
  accentInk: '#0B1530',
};

export function paletteFor(ws: WorkLine): WorkspacePalette {
  return ws === 'service' ? servicePalette : deliveryPalette;
}

/** The palette of the side that is open now. */
export function useWorkspacePalette(): WorkspacePalette {
  return paletteFor(useSession((s) => s.workspace));
}

export const WORKSPACE_LABEL: Record<WorkLine, string> = {
  delivery: 'Delivery',
  service: 'Service',
};

/** Where each side starts. */
export const WORKSPACE_HOME: Record<WorkLine, '/' | '/jobs'> = {
  delivery: '/',
  service: '/jobs',
};
