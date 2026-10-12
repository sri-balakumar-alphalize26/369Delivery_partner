import { peekServer } from './config';
import { demo } from './mock/shared';
import { serviceMockAdapter } from './mock/serviceAdapter';
import { ServiceApi } from './serviceTypes';
import { ApiError, PartnerInfo } from './types';

/**
 * Service jobs, demo or live, chosen per call like `api` in endpoints.ts.
 *
 * The live side waits for the senior's service module. Until it is on the
 * server, partner_app leaves Service out of `lines`, so no screen asks; if one
 * did, it is told plainly rather than shown an empty list that looks like a
 * quiet day.
 *
 * The one exception is a **test rider's preview** (`service_preview`): the
 * server opens Service for them anyway, and the sample jobs of demo mode fill
 * it, tied to the real rider's duty and delivery in hand.
 */

let preview = false;
/** What the demo fakes had before a preview took their hooks over. */
let saved: Pick<typeof demo, 'worksIn' | 'onDuty' | 'deliveryBusyRef'> | null = null;

/**
 * Follow what `/api/partner/me` said: preview on or off. `onDuty` reads the
 * real rider's duty switch. Null (signed out) ends any preview.
 */
export function setServicePreview(info: PartnerInfo | null, onDuty?: () => boolean): void {
  const on = !!info?.service_preview && !peekServer().useMock;
  if (on && info) {
    if (!saved) {
      saved = { worksIn: demo.worksIn, onDuty: demo.onDuty, deliveryBusyRef: demo.deliveryBusyRef };
    }
    demo.worksIn = info.work_type;
    demo.onDuty = onDuty ?? (() => false);
    const deliveryRef = info.busy_line === 'delivery' ? info.busy_ref : null;
    demo.deliveryBusyRef = () => deliveryRef;
  } else if (saved) {
    Object.assign(demo, saved);
    saved = null;
  }
  preview = on;
}

/** True while the Service side shows sample jobs on a real server. */
export function isServicePreview(): boolean {
  return preview;
}

const NOT_YET = 'Service jobs are not on this server yet. Ask the office.';

function notYet(): never {
  throw new ApiError('disabled', NOT_YET);
}

const serviceRestAdapter: ServiceApi = {
  jobs: async () => notYet(),
  job: async () => notYet(),
  accept: async () => notYet(),
  decline: async () => notYet(),
  startTravel: async () => notYet(),
  arrived: async () => notYet(),
  startWork: async () => notYet(),
  finishWork: async () => notYet(),
  sendSignoffCode: async () => notYet(),
  verifySignoff: async () => notYet(),
  needsRevisit: async () => notYet(),
  reportIssue: async () => notYet(),
  addPhoto: async () => notYet(),
};

export const serviceApi: ServiceApi = new Proxy({} as ServiceApi, {
  get(_target, prop: string) {
    const adapter = peekServer().useMock || preview ? serviceMockAdapter : serviceRestAdapter;
    return (adapter as unknown as Record<string, unknown>)[prop];
  },
});
