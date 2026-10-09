import { WorkLine } from '../api/types';

/**
 * Which job a notification or ring is about. Kept apart from `openJob` so the
 * background ring code can read a payload without loading the router.
 */
export interface JobRef {
  kind: WorkLine;
  id: number;
}

/** Delivery payloads predate `job_type`, and carry `delivery_order_id` alone. */
export function jobFromData(data: Record<string, unknown> | undefined | null): JobRef | null {
  if (!data) return null;
  if (data.job_type === 'service') {
    const id = Number(data.job_id);
    return Number.isFinite(id) && id > 0 ? { kind: 'service', id } : null;
  }
  const id = Number(data.delivery_order_id ?? (data.job_type === 'delivery' ? data.job_id : undefined));
  return Number.isFinite(id) && id > 0 ? { kind: 'delivery', id } : null;
}
