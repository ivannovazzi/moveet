import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import * as api from "./adapterClient";
import client from "@/utils/client";

export type AdapterStatus = "healthy" | "unhealthy" | "unreachable";

export function getBadgeStatus(health: HealthResponse | null): AdapterStatus {
  if (!health) return "unreachable";
  const sourceOk = !health.source || health.source.healthy;
  const sinksOk = health.sinks.every((s) => s.healthy);
  return sourceOk && sinksOk ? "healthy" : "unhealthy";
}

interface AdapterState {
  health: HealthResponse | null;
  config: ConfigResponse | null;
  loading: boolean;
  error: string | null;
}

export function useAdapterConfig(isOpen: boolean) {
  const [state, setState] = useState<AdapterState>({
    health: null,
    config: null,
    loading: false,
    error: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const health = await api.getHealth();
      setState((prev) => ({ ...prev, health, error: null }));
    } catch {
      setState((prev) => {
        if (prev.health === null && prev.error === "Connections unreachable") return prev;
        return { ...prev, health: null, error: "Connections unreachable" };
      });
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true }));
      const config = await api.getConfig();
      setState((prev) => ({
        ...prev,
        config,
        health: config.status,
        loading: false,
        error: null,
      }));
    } catch {
      setState((prev) => ({ ...prev, loading: false, error: "Failed to load config" }));
    }
  }, []);

  // Poll health at different rates depending on drawer state
  useEffect(() => {
    const interval = isOpen ? 5_000 : 30_000;
    void fetchHealth();
    timerRef.current = setInterval(() => void fetchHealth(), interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, fetchHealth]);

  // Load full config when drawer opens
  useEffect(() => {
    if (isOpen) void fetchConfig();
  }, [isOpen, fetchConfig]);

  const setSource = useCallback(
    async (type: string, config?: Record<string, unknown>) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const res = await api.setSource(type, config);
        setState((prev) => ({ ...prev, health: res.status, loading: false }));
        await fetchConfig();
        // Reset simulator so it re-fetches vehicles from the new source
        await client.reset();
      } catch (e) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : "Failed to set source",
        }));
      }
    },
    [fetchConfig]
  );

  const addSink = useCallback(
    async (type: string, config?: Record<string, unknown>) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const res = await api.addSink(type, config);
        setState((prev) => ({ ...prev, health: res.status, loading: false }));
        await fetchConfig();
      } catch (e) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : "Failed to add sink",
        }));
      }
    },
    [fetchConfig]
  );

  const removeSink = useCallback(
    async (type: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const res = await api.removeSink(type);
        setState((prev) => ({ ...prev, health: res.status, loading: false }));
        await fetchConfig();
      } catch (e) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : "Failed to remove sink",
        }));
      }
    },
    [fetchConfig]
  );

  return {
    health: state.health,
    config: state.config,
    loading: state.loading,
    error: state.error,
    status: getBadgeStatus(state.health),
    setSource,
    addSink,
    removeSink,
  };
}
