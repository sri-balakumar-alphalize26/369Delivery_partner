import { useEffect, useState } from 'react';
import { peekServer } from '../api/config';
import { DeliveryOrder } from '../api/types';
import { coords } from '../lib/format';
import { fetchRoute } from '../lib/route';

/**
 * How long this job is, by road.
 *
 * Shop to customer is fixed for the life of a job, so `fetchRoute`'s cache means
 * one request per job for the whole session — a handful against a 2000/day
 * allowance, not one per render and not one per poll. That is what makes a real
 * road distance affordable on a list; anything keyed on the rider's moving
 * position would not be.
 *
 * Straight-line was the cheap alternative and is deliberately not used: measured
 * against the real route it under-reports by about a fifth — 17.3km against the
 * 20.6km of road on the demo job — and a rider planning a shift around a
 * distance that short is worse served than by no number at all.
 *
 * Null until it resolves, and null forever without coordinates or a key. Every
 * live row still has a null customer latitude, so this shows in demo only until
 * Odoo geocodes addresses — the same wait the map is on.
 */
export function useJobDistance(job: DeliveryOrder): number | null {
  const [metres, setMetres] = useState<number | null>(null);

  const shop = typeof job.shop === 'object' ? coords(job.shop.latitude, job.shop.longitude) : null;
  const customer = coords(job.latitude, job.longitude);

  // Primitives, so the effect does not re-run on a fresh object each render —
  // the mistake that once cancelled every route request in flight.
  const key = shop && customer
    ? `${shop.latitude},${shop.longitude}>${customer.latitude},${customer.longitude}`
    : null;

  useEffect(() => {
    if (!shop || !customer || !key) return;

    let alive = true;
    fetchRoute(shop, customer, peekServer().orsKey).then((route) => {
      if (alive && route) setMetres(route.distanceM);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return metres;
}
