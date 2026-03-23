import classNames from "classnames";
import type { ConnectionStateInfo } from "@/utils/wsClient";
import styles from "./ConnectionStatus.module.css";

interface ConnectionStatusProps {
  connectionInfo: ConnectionStateInfo;
}

export default function ConnectionStatus({ connectionInfo }: ConnectionStatusProps) {
  const { state, attempt, maxAttempts } = connectionInfo;

  if (state === "connected" || state === "connecting") return null;

  const isReconnecting = state === "reconnecting";

  return (
    <div
      className={classNames(styles.banner, {
        [styles.reconnecting]: isReconnecting,
        [styles.disconnected]: !isReconnecting,
      })}
      role="alert"
      data-testid="connection-status"
    >
      {isReconnecting
        ? `Reconnecting... (attempt ${attempt + 1}/${maxAttempts})`
        : "Disconnected — please refresh the page"}
    </div>
  );
}
