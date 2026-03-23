import { isValidMessage } from "./wsTypes";
import { calculateBackoffDelay } from "./backoff";

type HandlerFn<T = unknown> = (data: T) => void;

const MAX_RECONNECT_ATTEMPTS = 10;

export type ConnectionState = "connected" | "reconnecting" | "disconnected";

export type ConnectionStateInfo = {
  state: ConnectionState;
  attempt: number;
  maxAttempts: number;
};

export type ConnectionStateListener = (info: ConnectionStateInfo) => void;

interface WebSocketClientOptions {
  autoReconnect?: boolean;
  logReconnects?: boolean;
  maxReconnectAttempts?: number;
  logger?: Pick<Console, "log" | "error">;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, Set<HandlerFn<any>>>();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private connectionStateListeners = new Set<ConnectionStateListener>();
  private _connectionState: ConnectionState = "disconnected";

  constructor(
    private wsUrl: string,
    private options: WebSocketClientOptions = {}
  ) {}

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private dispatch(type: string, data: unknown): void {
    const handlers = this.handlers.get(type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error("WS handler error for type:", type, err);
      }
    }
  }

  private setConnectionState(state: ConnectionState) {
    this._connectionState = state;
    const maxAttempts = this.options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;
    const info: ConnectionStateInfo = {
      state,
      attempt: this.reconnectAttempts,
      maxAttempts,
    };
    for (const listener of this.connectionStateListeners) {
      listener(info);
    }
  }

  onConnectionStateChange(listener: ConnectionStateListener): () => void {
    this.connectionStateListeners.add(listener);
    return () => {
      this.connectionStateListeners.delete(listener);
    };
  }

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

        if (msg.type === "connect" || msg.type === "disconnect") {
          this.dispatch(msg.type, {});
        } else {
          this.dispatch(msg.type, msg.data);
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };

    ws.onopen = () => {
      if (this.ws !== ws) return;
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      this.setConnectionState("connected");
      this.dispatch("connect", {});
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dispatch("disconnect", {});

      // Do not auto-reconnect if the close was intentional
      if (this.manualClose) {
        this.setConnectionState("disconnected");
        return;
      }

      if (this.options.autoReconnect === false) {
        this.setConnectionState("disconnected");
        return;
      }

      const maxReconnectAttempts = this.options.maxReconnectAttempts ?? MAX_RECONNECT_ATTEMPTS;

      // Implement exponential backoff for reconnection
      if (this.reconnectAttempts < maxReconnectAttempts) {
        this.setConnectionState("reconnecting");
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
        this.setConnectionState("disconnected");
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

  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on<T = unknown>(type: string, handler: HandlerFn<T>) {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set.add(handler as HandlerFn<any>);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(type: string, handler?: HandlerFn<any>) {
    if (handler) {
      const set = this.handlers.get(type);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.handlers.delete(type);
      }
    } else {
      this.handlers.delete(type);
    }
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
    this.setConnectionState("disconnected");
  }
}
