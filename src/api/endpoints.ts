import { peekServer } from './config';
import { mockAdapter } from './mock/adapter';
import { realAdapter } from './real/adapter';
import { ApiAdapter } from './types';

/**
 * The one place that decides which backend the app talks to.
 *
 * The choice is made per call, not once at import, because the Connect screen
 * can switch between demo data and the live server while the app is running.
 * A `Proxy` keeps every call site as a plain `api.orders()` — no wiring change
 * anywhere else.
 */
export const api: ApiAdapter = new Proxy({} as ApiAdapter, {
  get(_target, prop: string) {
    const adapter = peekServer().useMock ? mockAdapter : realAdapter;
    return (adapter as unknown as Record<string, unknown>)[prop];
  },
});

export function isMock(): boolean {
  return peekServer().useMock;
}
