import type { AdapterStatus } from "./useAdapterConfig";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<AdapterStatus, string> = {
  healthy: "bg-status-ok",
  unhealthy: "bg-status-error",
  unreachable: "bg-status-idle",
};

export default function HealthBadge({ status }: { status: AdapterStatus }) {
  return (
    <span
      className={cn("inline-block size-2.5 rounded-full", STATUS_CLASS[status])}
      title={status}
    />
  );
}
