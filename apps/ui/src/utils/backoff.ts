export const INITIAL_RECONNECT_DELAY = 1000;
export const MAX_RECONNECT_DELAY = 30000;

export function calculateBackoffDelay(
  attempt: number,
  initialDelay: number = INITIAL_RECONNECT_DELAY,
  maxDelay: number = MAX_RECONNECT_DELAY
): number {
  return Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
}
