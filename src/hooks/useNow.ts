import { useEffect, useState } from 'react';
import { serverNow } from '../lib/clock';

/**
 * A clock that re-renders its caller, so countdowns count.
 *
 * A label reading "12 min left" is only true for a minute, and nothing else on
 * these screens changes often enough to redraw it — the orders poll returns the
 * same data for ten seconds at a time and React has no reason to re-render.
 *
 * Thirty seconds by default: the labels resolve to whole minutes, so a faster
 * tick would redraw the same string, and a slower one would let a minute-old
 * value sit on screen.
 *
 * Reads `serverNow()` rather than `Date.now()`, so a phone with a wrong clock
 * still counts against the right one.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);

  return now;
}
