import { cn } from "@/lib/utils";
import type { ConnectionStateInfo } from "@/utils/wsClient";

interface ConnectionStatusProps {
  connectionInfo: ConnectionStateInfo;
  /** Invoked when the user clicks Retry after reconnection gave up. */
  onRetry?: () => void;
}

export default function ConnectionStatus({ connectionInfo, onRetry }: ConnectionStatusProps) {
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
      {isReconnecting ? (
        `Reconnecting... (attempt ${attempt + 1}/${maxAttempts})`
      ) : (
        <span className="inline-flex items-center gap-3">
          Disconnected
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-background/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-background/15"
            data-testid="connection-retry"
          >
            Retry
          </button>
          <span className="text-xs opacity-80">or refresh the page</span>
        </span>
      )}
    </div>
  );
}
