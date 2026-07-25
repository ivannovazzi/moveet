import { describe, it, expect } from "vitest";
import { CircuitBreaker, DEFAULT_BREAKER_OPTIONS } from "./circuit-breaker";
import { metrics } from "../metrics";

/** A manually advanced clock so cooldown behaviour is deterministic. */
function fakeClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

const OPTIONS = { enabled: true, failureThreshold: 3, cooldownMs: 1_000 };

describe("CircuitBreaker", () => {
  it("stays closed and allows requests below the failure threshold", () => {
    const breaker = new CircuitBreaker("cb-below", OPTIONS, fakeClock().now);

    breaker.recordFailure("boom");
    breaker.recordFailure("boom");

    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("opens after the configured consecutive failures and blocks requests", () => {
    const breaker = new CircuitBreaker("cb-open", OPTIONS, fakeClock().now);

    for (let i = 0; i < 3; i++) breaker.recordFailure("broker down");

    expect(breaker.getState()).toBe("open");
    expect(breaker.allowRequest()).toBe(false);
  });

  it("resets the failure run on a success", () => {
    const breaker = new CircuitBreaker("cb-reset", OPTIONS, fakeClock().now);

    breaker.recordFailure("x");
    breaker.recordFailure("x");
    breaker.recordSuccess();
    breaker.recordFailure("x");
    breaker.recordFailure("x");

    expect(breaker.getState()).toBe("closed");
    expect(breaker.getConsecutiveFailures()).toBe(2);
  });

  it("does not trip or reset on a partial delivery", () => {
    const breaker = new CircuitBreaker("cb-partial", OPTIONS, fakeClock().now);

    breaker.recordFailure("x");
    breaker.recordPartial();
    breaker.recordPartial();

    // The backend answered, so a partial is not breaker evidence either way.
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getConsecutiveFailures()).toBe(1);
  });

  it("allows exactly one trial publish after the cooldown, then closes on success", () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("cb-halfopen", OPTIONS, clock.now);
    for (let i = 0; i < 3; i++) breaker.recordFailure("down");

    expect(breaker.allowRequest()).toBe(false);
    clock.advance(1_000);

    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.getState()).toBe("half-open");
    // Only one trial in flight.
    expect(breaker.allowRequest()).toBe(false);

    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("re-opens and restarts the cooldown when the trial publish fails", () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("cb-retrip", OPTIONS, clock.now);
    for (let i = 0; i < 3; i++) breaker.recordFailure("down");
    clock.advance(1_000);
    expect(breaker.allowRequest()).toBe(true);

    breaker.recordFailure("still down");

    expect(breaker.getState()).toBe("open");
    expect(breaker.allowRequest()).toBe(false);
    clock.advance(1_000);
    expect(breaker.allowRequest()).toBe(true);
  });

  it("closes immediately when the reconnect sweep proves the sink healthy", () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker("cb-sweep", OPTIONS, clock.now);
    for (let i = 0; i < 3; i++) breaker.recordFailure("down");
    expect(breaker.allowRequest()).toBe(false);

    breaker.close("sink reconnected");

    // No cooldown wait: the sweep already proved the backend is back.
    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.getConsecutiveFailures()).toBe(0);
  });

  it("keeps the failure run of an already-closed breaker when the sweep runs", () => {
    const breaker = new CircuitBreaker("cb-sweep-closed", OPTIONS, fakeClock().now);
    breaker.recordFailure("publish rejected");
    breaker.recordFailure("publish rejected");

    // The health probe passes but publishes keep failing (e.g. missing topic).
    // Wiping the counter every sweep would make the breaker untrippable.
    breaker.close("sink health probe succeeded");
    expect(breaker.getConsecutiveFailures()).toBe(2);

    breaker.recordFailure("publish rejected");
    expect(breaker.getState()).toBe("open");
  });

  it("is inert when disabled", () => {
    const breaker = new CircuitBreaker(
      "cb-disabled",
      { ...OPTIONS, enabled: false },
      fakeClock().now
    );

    for (let i = 0; i < 20; i++) breaker.recordFailure("down");

    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("closes an already-open breaker when it is reconfigured to disabled", () => {
    const breaker = new CircuitBreaker("cb-reconfig", OPTIONS, fakeClock().now);
    for (let i = 0; i < 3; i++) breaker.recordFailure("down");
    expect(breaker.getState()).toBe("open");

    breaker.reconfigure({ ...OPTIONS, enabled: false });

    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("exports its state on the metrics gauge (0 closed / 2 open)", async () => {
    const breaker = new CircuitBreaker("cb-metrics", OPTIONS, fakeClock().now);

    const gauge = async (): Promise<number | undefined> => {
      const json = await metrics.sinkBreakerState.get();
      return json.values.find((v) => v.labels.sink === "cb-metrics")?.value;
    };

    // Visible at zero from construction, not only once it fails.
    expect(await gauge()).toBe(0);

    for (let i = 0; i < 3; i++) breaker.recordFailure("down");
    expect(await gauge()).toBe(2);

    const text = await metrics.registry.metrics();
    expect(text).toContain('adapter_sink_breaker_state{sink="cb-metrics"} 2');
    expect(text).toContain(
      'adapter_sink_breaker_transitions_total{sink="cb-metrics",state="open"}'
    );
  });

  it("defaults to on, 5 consecutive failures, 30s cooldown", () => {
    expect(DEFAULT_BREAKER_OPTIONS).toEqual({
      enabled: true,
      failureThreshold: 5,
      cooldownMs: 30_000,
    });
  });
});
