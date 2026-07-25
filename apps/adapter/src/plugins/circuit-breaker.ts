import { metrics } from "../metrics";
import { createLogger } from "../utils/logger";

const logger = createLogger("CircuitBreaker");

/**
 * Per-sink circuit breaker.
 *
 * A sink whose backend has gone away fails *every* publish. Without a breaker
 * the adapter keeps calling it on every `POST /sync` — each call pays the
 * sink's full timeout/retry budget, and the only trace is a growing pile of
 * identical error logs. The breaker makes that state explicit: after
 * `failureThreshold` consecutive whole-sink failures it **opens**, publishes to
 * that sink are skipped (fast, no backend call), and the state is exported on
 * `adapter_sink_breaker_state{sink}` so it is visible to monitoring rather than
 * silent.
 *
 * States:
 *  - `closed`    — normal. Every publish is attempted.
 *  - `open`      — publishes are skipped until `cooldownMs` has elapsed.
 *  - `half-open` — after the cooldown, exactly one trial publish is allowed
 *                  through. Success closes the breaker; failure re-opens it and
 *                  restarts the cooldown.
 *
 * What counts as a failure is deliberately narrow: only a **whole-sink throw**
 * (the sink could not deliver anything). A partial result — some chunks
 * delivered, some not — proves the backend is reachable, so it neither trips
 * nor resets the breaker (see {@link recordPartial}).
 *
 * The breaker is closed by two independent paths, which is what lets it
 * compose with the manager's existing sink-reconnect sweep:
 *  1. the cooldown/half-open trial on the publish path, and
 *  2. {@link close}, called by `PluginManager.reconnectUnhealthySinks()` when a
 *     health probe (or a successful reconnect) proves the backend is back.
 * Path 2 means recovery does not have to wait for the next inbound publish.
 */
export type BreakerState = "closed" | "half-open" | "open";

export interface CircuitBreakerOptions {
  /** When false the breaker is inert: every publish is allowed, no state changes. */
  enabled: boolean;
  /** Consecutive whole-sink failures required to open the breaker. */
  failureThreshold: number;
  /** How long an open breaker stays open before allowing one trial publish (ms). */
  cooldownMs: number;
}

export const DEFAULT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  enabled: true,
  failureThreshold: 5,
  cooldownMs: 30_000,
};

/** Injectable clock so tests can drive the cooldown deterministically. */
export type Clock = () => number;

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  /** True while a half-open trial publish is outstanding (only one is allowed). */
  private probeInFlight = false;

  constructor(
    readonly sink: string,
    private options: CircuitBreakerOptions = DEFAULT_BREAKER_OPTIONS,
    private readonly now: Clock = Date.now
  ) {
    // Publish the initial state so every sink shows up in the metrics output,
    // not just the ones that have already failed.
    metrics.setBreakerState(this.sink, this.state);
  }

  /** Apply new options in place (used when delivery options are (re)configured). */
  reconfigure(options: CircuitBreakerOptions): void {
    this.options = options;
    if (!options.enabled && this.state !== "closed") {
      this.transition("closed", "breaker disabled");
      this.consecutiveFailures = 0;
      this.probeInFlight = false;
    }
  }

  getState(): BreakerState {
    return this.state;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Should this publish be attempted? Also performs the open → half-open
   * transition once the cooldown has elapsed, handing out exactly one trial.
   */
  allowRequest(): boolean {
    if (!this.options.enabled) return true;

    if (this.state === "closed") return true;

    if (this.state === "open") {
      if (this.now() - this.openedAt < this.options.cooldownMs) return false;
      this.transition("half-open", "cooldown elapsed");
      this.probeInFlight = true;
      return true;
    }

    // half-open: only one trial publish in flight at a time.
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  /** A whole-sink publish succeeded: reset the failure run and close the breaker. */
  recordSuccess(): void {
    this.probeInFlight = false;
    this.consecutiveFailures = 0;
    if (this.state !== "closed") this.transition("closed", "publish succeeded");
  }

  /**
   * A publish partially delivered. The backend is demonstrably reachable, so a
   * half-open trial counts as recovery, but a partial result in the closed
   * state neither trips the breaker nor resets an existing failure run — it is
   * simply not evidence either way about total sink availability.
   */
  recordPartial(): void {
    this.probeInFlight = false;
    if (this.state === "half-open") this.transition("closed", "trial publish partially delivered");
  }

  /** A whole-sink publish threw: count it, and open the breaker at the threshold. */
  recordFailure(error?: string): void {
    if (!this.options.enabled) return;
    this.probeInFlight = false;
    this.consecutiveFailures += 1;

    if (this.state === "half-open") {
      this.open(`trial publish failed: ${error ?? "unknown error"}`);
      return;
    }
    if (this.state === "closed" && this.consecutiveFailures >= this.options.failureThreshold) {
      this.open(
        `${this.consecutiveFailures} consecutive failures (last: ${error ?? "unknown error"})`
      );
    }
  }

  /**
   * Force the breaker closed. Called by the manager's sink-reconnect sweep when
   * a health probe or a successful reconnect proves the backend is back, so
   * recovery does not have to wait for a half-open trial on the publish path.
   */
  close(reason: string): void {
    // Only a breaker that actually tripped is reset. A *closed* breaker keeps
    // its failure run: a sink that health-checks fine but fails every publish
    // (missing topic, write-only auth problem) must still be able to trip,
    // rather than having its counter wiped by every reconnect sweep.
    if (this.state === "closed") return;
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
    this.transition("closed", reason);
  }

  private open(reason: string): void {
    this.openedAt = this.now();
    this.transition("open", reason);
  }

  private transition(next: BreakerState, reason: string): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    metrics.setBreakerState(this.sink, next);
    metrics.recordBreakerTransition(this.sink, next);
    const line = `Sink circuit breaker ${previous} → ${next}: ${reason}`;
    if (next === "open") logger.error({ sink: this.sink }, line);
    else logger.warn({ sink: this.sink }, line);
  }
}
