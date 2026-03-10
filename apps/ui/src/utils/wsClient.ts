import { isValidMessage } from "./wsTypes";
import { calculateBackoffDelay } from "./backoff";

type HandlerFn<T = unknown> = (data: T) => void;

const MAX_RECONNECT_ATTEMPTS = 10;

interface WebSocketClientOptions {
  autoReconnect?: boolean;
  logReconnects?: boolean;
  maxReconnectAttempts?: number;
  logger?: Pick<Console, "log" | "error">;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, HandlerFn<any>>();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  constructor(
    private wsUrl: string,
    private options: WebSocketClientOptions = {}
  ) {}

  connect() {
    if (this.ws) return; // Already connected
    this.manualClose = false;
    this.ws = new WebSocket(this.wsUrl);

    // Capture reference so closures can detect stale sockets.
    // In React StrictMode, disconnect() + connect() run synchronously,
    // but the old socket's onclose fires asynchronously. Without this
    // guard, the old onclose sets this.ws = null, clobbering the new
    // connection and triggering spurious reconnection.
    const ws = this.ws;

    ws.onmessage = (evt) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(evt.data);

        // Validate message structure
        if (!isValidMessage(msg)) {
          console.error("Invalid WebSocket message structure:", msg);
          return;
        }

        const handler = this.handlers.get(msg.type);
        if (handler) {
          // For connect/disconnect, no data is passed
          if (msg.type === "connect" || msg.type === "disconnect") {
            handler({});
          } else {
            handler(msg.data);
          }
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };

    ws.onopen = () => {
      if (this.ws !== ws) return;
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      this.handlers.get("connect")?.({});
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.get("disconnect")?.({});

      // Do not auto-reconnect if the close was intentional
      if (this.manualClose) return;

      if (this.options.autoReconnect === false) return;

      const maxReconnectAttempts = this.options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;

      // Implement exponential backoff for reconnection
      if (this.reconnectAttempts < maxReconnectAttempts) {
        const delay = calculateBackoffDelay(this.reconnectAttempts);

        if (this.options.logReconnects !== false) {
          (this.options.logger ?? console).log(
            `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${maxReconnectAttempts})`
          );
        }

        this.reconnectTimeout = setTimeout(() => {
          this.reconnectAttempts++;
          this.connect();
        }, delay);
      } else {
        (this.options.logger ?? console).error(
          "Max reconnection attempts reached. Please refresh the page."
        );
      }
    };

    ws.onerror = (err) => {
      (this.options.logger ?? console).error("WebSocket error:", err);
      ws.close();
    };
  }

  on<T = unknown>(type: string, handler: HandlerFn<T>) {
    this.handlers.set(type, handler);
  }

  off(type: string) {
    this.handlers.delete(type);
  }

  disconnect() {
    this.manualClose = true;
    // Clear reconnect timeout when manually disconnecting
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
    this.ws?.close();
    this.ws = null;
  }
}
