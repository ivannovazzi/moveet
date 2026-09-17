import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWeather } from "./useWeather";
import client from "@/utils/client";
import type { WeatherDTO } from "@/types";

type ConnectHandler = () => void;
type WeatherHandler = (data: WeatherDTO) => void;

let connectHandlers: ConnectHandler[] = [];
let weatherHandlers: WeatherHandler[] = [];

vi.mock("@/utils/client", () => ({
  default: {
    getWeather: vi.fn(),
    onConnect: vi.fn((h: ConnectHandler) => {
      connectHandlers.push(h);
    }),
    offConnect: vi.fn((h: ConnectHandler) => {
      connectHandlers = connectHandlers.filter((x) => x !== h);
    }),
    onWeather: vi.fn((h: WeatherHandler) => {
      weatherHandlers.push(h);
    }),
    offWeather: vi.fn((h: WeatherHandler) => {
      weatherHandlers = weatherHandlers.filter((x) => x !== h);
    }),
  },
}));

const CLEAR: WeatherDTO = {
  condition: "clear",
  speedFactor: 1,
  source: "live",
  observedAt: 1_000,
};

const RAIN: WeatherDTO = {
  condition: "rain",
  speedFactor: 0.82,
  source: "live",
  observedAt: 2_000,
};

describe("useWeather", () => {
  beforeEach(() => {
    connectHandlers = [];
    weatherHandlers = [];
    vi.mocked(client.getWeather).mockResolvedValue({ data: CLEAR });
  });
  afterEach(() => vi.clearAllMocks());

  it("seeds from the REST snapshot", async () => {
    const { result } = renderHook(() => useWeather());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(CLEAR));
  });

  it("follows the weather channel", async () => {
    const { result } = renderHook(() => useWeather());
    await waitFor(() => expect(result.current).toEqual(CLEAR));

    act(() => {
      for (const handler of weatherHandlers) handler(RAIN);
    });
    expect(result.current).toEqual(RAIN);
  });

  it("re-reads on reconnect, since a change could have landed while the socket was down", async () => {
    const { result } = renderHook(() => useWeather());
    await waitFor(() => expect(result.current).toEqual(CLEAR));

    vi.mocked(client.getWeather).mockResolvedValue({ data: RAIN });
    act(() => {
      for (const handler of connectHandlers) handler();
    });
    await waitFor(() => expect(result.current).toEqual(RAIN));
  });

  it("stays null when the endpoint fails rather than inventing clear weather", async () => {
    vi.mocked(client.getWeather).mockRejectedValue(new Error("offline"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useWeather());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(result.current).toBeNull();
    spy.mockRestore();
  });

  it("detaches both listeners on unmount", async () => {
    const { unmount } = renderHook(() => useWeather());
    await waitFor(() => expect(weatherHandlers).toHaveLength(1));
    unmount();
    expect(weatherHandlers).toHaveLength(0);
    expect(connectHandlers).toHaveLength(0);
  });
});
