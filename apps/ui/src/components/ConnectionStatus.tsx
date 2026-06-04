import { cn } from "@/lib/utils";
import type { ConnectionStateInfo } from "@/utils/wsClient";

interface ConnectionStatusProps {
  connectionInfo: ConnectionStateInfo;
}

export default function ConnectionStatus({ connectionInfo }: ConnectionStatusProps) {
  const { state, attempt, maxAttempts } = connectionInfo;

  if (state === "connected" || state === "connecting") return null;

  const isReconnecting = state === "reconnecting";

  return (
    <div
      className={cn(
        "absolute inset-x-0 top-0 z-50 px-6 py-3 text-center text-sm font-medium tracking-wide text-background",
        isReconnecting ? "bg-status-warn" : "bg-status-error"
      )}
      role="alert"
      data-testid="connection-status"
    >
      {isReconnecting
        ? `Reconnecting... (attempt ${attempt + 1}/${maxAttempts})`
        : "Disconnected — please refresh the page"}
    </div>
  );
}
