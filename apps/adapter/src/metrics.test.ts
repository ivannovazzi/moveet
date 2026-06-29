import { describe, it, expect } from "vitest";
import { AdapterMetrics } from "./metrics";

describe("AdapterMetrics", () => {
  it("exposes the default + custom collectors in the registry output", async () => {
    const m = new AdapterMetrics();
    const text = await m.registry.metrics();
    // A default process metric is present (collectDefaultMetrics wired up).
    expect(text).toContain("process_cpu_user_seconds_total");
    // Custom collectors are registered (HELP lines present even at zero).
    expect(text).toContain("adapter_sink_delivery_total");
    expect(text).toContain("adapter_publish_duration_seconds");
  });

  it("counts sink deliveries by sink + outcome", async () => {
    const m = new AdapterMetrics();
    m.recordDelivery("redpanda", "success", 5);
    m.recordDelivery("redpanda", "drop", 2);
    m.recordDelivery("graphql", "failure");

    const success = await m.registry.getSingleMetric("adapter_sink_delivery_total");
    const json = await (success as NonNullable<typeof success>).get();
    const byKey = Object.fromEntries(
      json.values.map((v) => [`${v.labels.sink}:${v.labels.outcome}`, v.value])
    );
    expect(byKey["redpanda:success"]).toBe(5);
    expect(byKey["redpanda:drop"]).toBe(2);
    expect(byKey["graphql:failure"]).toBe(1);
  });

  it("ignores non-positive delivery counts", async () => {
    const m = new AdapterMetrics();
    m.recordDelivery("redpanda", "success", 0);
    m.recordDelivery("redpanda", "drop", -3);

    const metric = await m.registry.getSingleMetric("adapter_sink_delivery_total");
    const json = await (metric as NonNullable<typeof metric>).get();
    expect(json.values).toHaveLength(0);
  });

  it("serves the registry via the /metrics handler with the right content-type", async () => {
    const m = new AdapterMetrics();
    m.recordDelivery("redpanda", "success");

    let contentType = "";
    let body = "";
    const res = {
      set: (_k: string, v: string) => {
        contentType = v;
      },
      send: (b: string) => {
        body = b;
      },
    } as never;

    await m.metricsHandler({} as never, res);
    expect(contentType).toContain("text/plain");
    expect(body).toContain("adapter_sink_delivery_total");
  });
});
