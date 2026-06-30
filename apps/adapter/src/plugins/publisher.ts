import type { VehicleUpdate } from "../types";
import type { DataSink, PublishContext, PublishResult, SinkResult } from "./types";
import { createLogger } from "../utils/logger";
import { metrics } from "../metrics";

const logger = createLogger("Publisher");

/**
 * Publisher — coordinates publishing vehicle updates across active sinks.
 *
 * Fan-out is concurrent (Promise.allSettled) and errors in individual sinks
 * are caught so they never prevent other sinks from receiving updates.
 *
 * Sinks may return partial-success metadata (attempted/succeeded/failures)
 * which is forwarded to the caller via each SinkResult.
 *
 * Each settled result is mirrored onto the `adapter_sink_delivery_total`
 * counter: a clean publish counts as `success`, item/chunk-level partial
 * failures count as `drop` (attempted-but-undelivered, the sink's at-most-once
 * semantics), and a whole-sink throw counts as `failure`. This surfaces the
 * drop/failure counts that previously lived only in the 200/202 response body.
 */
export class Publisher {
  async publishUpdates(
    updates: VehicleUpdate[],
    activeSinks: Map<string, DataSink>,
    context?: PublishContext
  ): Promise<PublishResult> {
    const sinkEntries = Array.from(activeSinks.entries());

    const settled = await Promise.allSettled(
      sinkEntries.map(async ([type, sink]) => {
        // Only pass the context arg when present so existing call-site
        // expectations (sink.publishUpdates(updates)) stay exact.
        const result = context
          ? await sink.publishUpdates(updates, context)
          : await sink.publishUpdates(updates);
        const sinkResult: SinkResult = { type, success: true };

        // If the sink returned partial-failure metadata, incorporate it
        if (result && result.failures && result.failures.length > 0) {
          sinkResult.success = false;
          sinkResult.error = `${result.failures.length} of ${result.attempted} items failed`;
          sinkResult.failures = result.failures;
          sinkResult.attempted = result.attempted;
          sinkResult.succeeded = result.succeeded;
        } else if (result) {
          sinkResult.attempted = result.attempted;
          sinkResult.succeeded = result.succeeded;
        }

        return sinkResult;
      })
    );

    const sinkResults: SinkResult[] = settled.map((outcome, i) => {
      const sinkType = sinkEntries[i][0];
      if (outcome.status === "fulfilled") {
        this.recordSinkMetrics(sinkType, outcome.value);
        return outcome.value;
      }
      const err = outcome.reason;
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err, sink: sinkType }, `Sink ${sinkType} error`);
      // A whole-sink throw: the entire publish to this sink failed.
      metrics.recordDelivery(sinkType, "failure");
      return { type: sinkType, success: false, error };
    });

    const failCount = sinkResults.filter((r) => !r.success).length;
    let status: PublishResult["status"];
    if (failCount === 0) {
      status = "success";
    } else if (failCount < sinkResults.length) {
      status = "partial";
    } else {
      status = "failure";
    }

    return { status, sinks: sinkResults };
  }

  /**
   * Mirror a fulfilled sink result onto the delivery counter. When the sink
   * reported partial-failure metadata, the succeeded count is `success` and the
   * (attempted − succeeded) shortfall is `drop`; otherwise a clean publish
   * counts as a single `success`.
   */
  private recordSinkMetrics(sinkType: string, result: SinkResult): void {
    if (result.attempted != null && result.succeeded != null) {
      metrics.recordDelivery(sinkType, "success", result.succeeded);
      const dropped = result.attempted - result.succeeded;
      if (dropped > 0) metrics.recordDelivery(sinkType, "drop", dropped);
      return;
    }
    // Sink returned void / no metadata: count the publish as one success.
    metrics.recordDelivery(sinkType, "success");
  }
}
