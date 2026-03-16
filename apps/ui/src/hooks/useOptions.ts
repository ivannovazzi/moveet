import { useOptionsContext } from "@/data/useData";
import type { StartOptions } from "@/types";
import client from "@/utils/client";
import { useRef, useEffect } from "react";

export function useOptions(timeout: number) {
  const { options, setOptions } = useOptionsContext();
  const timer = useRef<NodeJS.Timeout | undefined>(undefined);

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

  const updateOption = <T extends keyof StartOptions>(field: T, value: StartOptions[T]) => {
    clearTimeout(timer.current);
    setOptions((options) => {
      const newOptions = { ...options, [field]: value };
      timer.current = setTimeout(async () => {
        await client.updateOptions(newOptions);
      }, timeout);
      return newOptions;
    });
  };

  return { options, updateOption };
}
