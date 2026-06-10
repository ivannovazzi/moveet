import { useOptionsContext } from "@/data/useData";
import type { StartOptions } from "@/types";
import client from "@/utils/client";
import { useRef, useEffect } from "react";

export function useOptions(timeout: number) {
  const { options, setOptions } = useOptionsContext();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Track the latest committed options so the debounced write (and the
  // unmount flush) always send the freshest state.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    client
      .getOptions()
      .then((optionsData) => {
        if (optionsData.data) setOptions(optionsData.data);
      })
      .catch((err) => console.error("Failed to load options:", err));
    client.onOptions((options) => {
      setOptions(options);
    });
  }, [setOptions]);

  // On unmount, flush (rather than silently drop) a pending debounced write
  // so the user's last change still reaches the server.
  useEffect(() => {
    return () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
        client.updateOptions(optionsRef.current).catch(() => {});
      }
    };
  }, []);

  const updateOption = <T extends keyof StartOptions>(field: T, value: StartOptions[T]) => {
    clearTimeout(timer.current);
    // Sync the ref immediately: the effect-based sync above only runs after a
    // re-render, so an unmount flush in the same commit as the last edit would
    // otherwise send stale options. The effect still handles server-initiated
    // updates (getOptions / onOptions).
    optionsRef.current = { ...optionsRef.current, [field]: value };
    // Keep the state updater pure — scheduling the timer inside it would run
    // the side effect twice under StrictMode and leak the first timer.
    setOptions((options) => ({ ...options, [field]: value }));
    timer.current = setTimeout(() => {
      timer.current = undefined;
      client.updateOptions(optionsRef.current).catch(() => {});
    }, timeout);
  };

  return { options, updateOption };
}
