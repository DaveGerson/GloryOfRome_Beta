export type DomainMutationResult<T> =
  | { acquired: false }
  | { acquired: true; value: T };

export interface DomainMutationContext {
  /** False after the owning lifecycle ends or this lease otherwise ceases to be current. */
  isCurrent: () => boolean;
}

/**
 * Runs one game-domain mutation under App's shared synchronous mutex.
 *
 * Acquisition failure is deliberately distinct from a mutation whose own
 * result is `false`: callers use `acquired` to reject a stale/re-entrant
 * control, while `value` retains the durable handler's success/failure
 * contract.
 */
export type RunDomainMutation = <T>(
  work: (context: DomainMutationContext) => T | Promise<T>,
) => Promise<DomainMutationResult<T>>;
