import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import * as api from "./adapterClient";
import client from "@/utils/client";
import { toast, toErrorMessage } from "@/lib/toast";

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
      setState((prev) => ({
        ...prev,
        health,
        error: null,
        config:
          prev.config && prev.config.realism && health.realism
            ? {
                ...prev.config,
                realism: { ...prev.config.realism, status: health.realism },
              }
            : prev.config,
      }));
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
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "Failed to load config",
      }));
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
        toast.success(`Source set to ${type}`);
      } catch (e) {
        const message = toErrorMessage(e, "Failed to set source");
        setState((prev) => ({ ...prev, loading: false, error: message }));
        toast.error(message);
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
        toast.success(`Sink "${type}" added`);
      } catch (e) {
        const message = toErrorMessage(e, "Failed to add sink");
        setState((prev) => ({ ...prev, loading: false, error: message }));
        toast.error(message);
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
        toast.success(`Sink "${type}" removed`);
      } catch (e) {
        const message = toErrorMessage(e, "Failed to remove sink");
        setState((prev) => ({ ...prev, loading: false, error: message }));
        toast.error(message);
      }
    },
    [fetchConfig]
  );

  const setRealism = useCallback(
    async (realismConfig: Record<string, unknown>) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        await api.setRealism(realismConfig);
        await fetchConfig();
        setState((prev) => ({ ...prev, loading: false }));
        toast.success("Realism settings updated");
      } catch (e) {
        const message = toErrorMessage(e, "Failed to set realism");
        setState((prev) => ({ ...prev, loading: false, error: message }));
        toast.error(message);
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
    setRealism,
  };
}
