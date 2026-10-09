/**
 * What the two demo servers - delivery (`adapter.ts`) and service
 * (`serviceAdapter.ts`) - need to know about each other, without importing
 * each other.
 *
 * On the real server this is one rider record: its Works In, its duty, and the
 * jobs it holds in both lines. Here each fake fills in its own half.
 */
export const demo = {
  /**
   * What the office set as "Works In" on the demo rider's record. Both by
   * default, so demo mode shows everything; Profile's demo controls change it.
   */
  worksIn: 'both' as 'delivery' | 'service' | 'both',
  /** Set by the delivery fake: is the demo rider on duty? One duty for both lines. */
  onDuty: (): boolean => false,
  /** Set by the delivery fake: the ref of a delivery in hand, or null. */
  deliveryBusyRef: (): string | null => null,
  /** Set by the service fake: the ref of a visit in hand, or null. */
  serviceBusyRef: (): string | null => null,
};
