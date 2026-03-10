import { useEffect, useState, useRef } from "react";

interface Size {
  width: number;
  height: number;
}

export const useResizeObserver = (): [React.RefObject<HTMLDivElement | null>, Size] => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;

    const observeTarget = ref.current;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!Array.isArray(entries)) return;
      if (!entries.length) return;

      const entry = entries[0];
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });

    resizeObserver.observe(observeTarget);

    return () => {
      resizeObserver.unobserve(observeTarget);
    };
  }, []);

  return [ref, size];
};
