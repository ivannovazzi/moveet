import type { VehicleUpdate } from "../types";
import type { DataSink, PublishResult, SinkResult } from "./types";

/**
 * Publisher — coordinates publishing vehicle updates across active sinks.
 *
 * Fan-out is concurrent (Promise.allSettled) and errors in individual sinks
 * are caught so they never prevent other sinks from receiving updates.
 *
 * Sinks may return partial-success metadata (attempted/succeeded/failures)
 * which is forwarded to the caller via each SinkResult.
 */
export class Publisher {
  async publishUpdates(
    updates: VehicleUpdate[],
    activeSinks: Map<string, DataSink>
  ): Promise<PublishResult> {
    const sinkEntries = Array.from(activeSinks.entries());

    const settled = await Promise.allSettled(
      sinkEntries.map(async ([type, sink]) => {
        const result = await sink.publishUpdates(updates);
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
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const err = outcome.reason;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`Sink ${sinkEntries[i][0]} error:`, err);
      return { type: sinkEntries[i][0], success: false, error };
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
}
