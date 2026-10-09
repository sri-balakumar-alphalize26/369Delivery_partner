import { create } from 'zustand';
import { api } from '../api/endpoints';
import { serviceApi } from '../api/service';
import { ApiError, WorkLine } from '../api/types';
import { useSession } from './session';

/**
 * One Accept at a time, across both lines.
 *
 * A hybrid agent can have a delivery offer and a service offer on screen in the
 * same second. Each job screen has its own spinner, so on its own nothing stops
 * both Accepts going out. This lock does: while one is on its way, every other
 * Accept button is off. The server still has the last word (409 `agent_busy`).
 */
export const useAcceptLock = create<{ busy: string | null }>(() => ({ busy: null }));

export async function withAcceptLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (useAcceptLock.getState().busy) {
    throw new ApiError('wrong_state', 'Another job is being accepted. One moment.');
  }
  useAcceptLock.setState({ busy: key });
  try {
    return await run();
  } finally {
    useAcceptLock.setState({ busy: null });
  }
}

/** Why an offer left: the agent took a job in the other line. */
export const BUSY_OTHER_JOB = 'busy_other_job';

/**
 * After an Accept in one line, hand back any offer still open in the other,
 * so it goes to the next person at once instead of sitting out its timer.
 * Best effort: an offer that has already gone is simply skipped. Returns how
 * many were passed back.
 */
export async function passBackOtherOffers(accepted: WorkLine): Promise<number> {
  const lines = useSession.getState().lines;
  let passed = 0;
  try {
    if (accepted === 'delivery' && lines.includes('service')) {
      const { jobs } = await serviceApi.jobs();
      for (const j of jobs.filter((x) => x.status === 'offered')) {
        await serviceApi.decline(j.id, BUSY_OTHER_JOB).then(() => passed++, () => {});
      }
    }
    if (accepted === 'service' && lines.includes('delivery')) {
      const { orders } = await api.orders();
      for (const o of orders.filter((x) => x.delivery_status === 'offered')) {
        await api.decline(o.delivery_order_id, BUSY_OTHER_JOB).then(() => passed++, () => {});
      }
    }
  } catch {
    // No signal: the offers lapse on their own timer instead.
  }
  return passed;
}
