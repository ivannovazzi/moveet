import type { ApiResponse } from "@/types";

export class HttpClient {
  constructor(private baseUrl: string) {}

  async get<T>(path: string): Promise<ApiResponse<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`);
      if (!res.ok) throw new Error(`GET ${path} failed with status ${res.status}`);
      const data = await res.json();
      return { data };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { data: undefined, error: errorMessage };
    }
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`DELETE ${path} failed with status ${res.status}`);
      // DELETE endpoints commonly reply 204 with no body; only parse JSON when
      // there is actually a body, so an empty response resolves cleanly instead
      // of throwing "Unexpected end of JSON input".
      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;
      return { data };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { data: undefined, error: errorMessage };
    }
  }

  async post<TBody, TReturn = void>(path: string, body?: TBody): Promise<ApiResponse<TReturn>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`POST ${path} failed with status ${res.status}`);
      const data = await res.json();
      return { data };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { data: undefined, error: errorMessage };
    }
  }

  async patch<TBody, TReturn = void>(path: string, body?: TBody): Promise<ApiResponse<TReturn>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`PATCH ${path} failed with status ${res.status}`);
      const data = await res.json();
      return { data };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { data: undefined, error: errorMessage };
    }
  }
}
