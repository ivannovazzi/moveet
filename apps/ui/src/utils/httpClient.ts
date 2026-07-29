import type { ApiResponse } from "@/types";

/**
 * The message to surface for a rejected request.
 *
 * The simulator answers a rejected request with `{ error, details? }` — the part
 * an operator can act on ("pickup is outside the road network bounds"). A bare
 * `POST /jobs failed with status 400` tells them nothing, so prefer the body and
 * keep the status line only as the fallback for an absent or unparseable one.
 */
async function readErrorMessage(
  res: { status: number; json?: () => Promise<unknown> },
  label: string
): Promise<string> {
  const fallback = `${label} failed with status ${res.status}`;
  try {
    const body = (await res.json?.()) as { error?: unknown; details?: unknown } | undefined;
    if (!body || typeof body !== "object") return fallback;
    const base = typeof body.error === "string" ? body.error : undefined;
    const details = Array.isArray(body.details)
      ? body.details.filter((d): d is string => typeof d === "string").join("; ")
      : undefined;
    if (base && details) return `${base}: ${details}`;
    return base ?? fallback;
  } catch {
    // A non-JSON error body is no worse than no body — fall back to the status.
    return fallback;
  }
}

export class HttpClient {
  constructor(private baseUrl: string) {}

  async get<T>(path: string): Promise<ApiResponse<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`);
      if (!res.ok) return { data: undefined, error: await readErrorMessage(res, `GET ${path}`) };
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
      if (!res.ok) {
        return { data: undefined, error: await readErrorMessage(res, `DELETE ${path}`) };
      }
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
      if (!res.ok) return { data: undefined, error: await readErrorMessage(res, `POST ${path}`) };
      const data = await res.json();
      return { data };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { data: undefined, error: errorMessage };
    }
  }

  async put<TBody, TReturn = void>(path: string, body?: TBody): Promise<ApiResponse<TReturn>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return { data: undefined, error: await readErrorMessage(res, `PUT ${path}`) };
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
      if (!res.ok) {
        return { data: undefined, error: await readErrorMessage(res, `PATCH ${path}`) };
      }
      const data = await res.json();
      return { data };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { data: undefined, error: errorMessage };
    }
  }
}
