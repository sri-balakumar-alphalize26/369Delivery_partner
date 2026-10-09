import { peekServer } from './config';
import { serviceMockAdapter } from './mock/serviceAdapter';
import { ServiceApi } from './serviceTypes';
import { ApiError } from './types';

/**
 * Service jobs, demo or live, chosen per call like `api` in endpoints.ts.
 *
 * The live side waits for the senior's service module. Until it is on the
 * server, partner_app leaves Service out of `lines`, so no screen asks; if one
 * did, it is told plainly rather than shown an empty list that looks like a
 * quiet day.
 */

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
    const adapter = peekServer().useMock ? serviceMockAdapter : serviceRestAdapter;
    return (adapter as unknown as Record<string, unknown>)[prop];
  },
});
