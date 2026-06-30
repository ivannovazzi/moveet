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
        "absolute inset-x-0 top-0 z-50 animate-fade-up px-6 py-3 text-center text-sm font-medium tracking-tight text-background shadow-elevated",
        isReconnecting ? "bg-status-warn" : "bg-status-error"
      )}
      role="alert"
      data-testid="connection-status"
    >
      {isReconnecting ? (
        <span className="inline-flex items-center gap-1.5">
          Reconnecting...{" "}
          <span className="tabular-nums opacity-80">
            (attempt {attempt + 1}/{maxAttempts})
          </span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-3">
          Disconnected
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-background/40 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors duration-fast ease-standard hover:bg-background/15"
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
