// Shared dependency surface for the client segments. Each domain segment
// receives the singleton HttpClient + WebSocketClient and exposes a cohesive
// group of REST/WS methods. The facade in ../client.ts composes the segments
// and re-exports their (already-bound) methods, so the public API is unchanged.
import type { HttpClient } from "../httpClient";
import type { WebSocketClient } from "../wsClient";

export interface ClientDeps {
  http: HttpClient;
  ws: WebSocketClient;
}
