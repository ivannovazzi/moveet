import type { VehicleUpdate } from "../types";
import type { DataSink, PublishResult, SinkResult } from "./types";

/**
 * Publisher — coordinates publishing vehicle updates across active sinks.
 *
 * Fan-out is concurrent (Promise.all) and errors in individual sinks
 * are caught so they never prevent other sinks from receiving updates.
 */
export class Publisher {
  async publishUpdates(
    updates: VehicleUpdate[],
    activeSinks: Map<string, DataSink>
  ): Promise<PublishResult> {
    const sinkEntries = Array.from(activeSinks.entries());

    const sinkResults: SinkResult[] = await Promise.all(
      sinkEntries.map(async ([type, sink]) => {
        try {
          await sink.publishUpdates(updates);
          return { type, success: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`Sink ${type} error:`, err);
          return { type, success: false, error };
        }
      })
    );

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
