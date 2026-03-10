import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "./httpClient";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const client = new HttpClient("http://localhost:5010");

beforeEach(() => {
  mockFetch.mockReset();
});

describe("HttpClient", () => {
  describe("get", () => {
    it("returns data on successful response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: "vehicle" }),
      });

      const result = await client.get("/vehicles");

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:5010/vehicles");
      expect(result).toEqual({ data: { id: 1, name: "vehicle" } });
      expect(result.error).toBeUndefined();
    });

    it("returns error when response is not ok", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });

      const result = await client.get("/missing");

      expect(result.data).toBeUndefined();
      expect(result.error).toBe("GET /missing failed with status 404");
    });

    it("returns error on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await client.get("/vehicles");

      expect(result.data).toBeUndefined();
      expect(result.error).toBe("Network error");
    });
  });

  describe("post", () => {
    it("sends body and returns data on successful response", async () => {
      const body = { count: 5 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ started: true }),
      });

      const result = await client.post("/start", body);

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:5010/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(result).toEqual({ data: { started: true } });
      expect(result.error).toBeUndefined();
    });

    it("sends request without body when body is undefined", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.post("/stop");

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:5010/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
    });

    it("returns error when response is not ok", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const result = await client.post("/start", { count: 5 });

      expect(result.data).toBeUndefined();
      expect(result.error).toBe("POST /start failed with status 500");
    });

    it("returns error on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const result = await client.post("/start", { count: 5 });

      expect(result.data).toBeUndefined();
      expect(result.error).toBe("Connection refused");
    });
  });
});
