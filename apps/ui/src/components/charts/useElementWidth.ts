import { useEffect, useState, type RefObject } from "react";

/**
 * Observed content width of an element, in CSS px.
 *
 * The charts draw in real pixel coordinates rather than stretching a viewBox,
 * so SVG text stays crisp and end dots stay round. Under jsdom (and before the
 * first observation) the hook reports `fallback`, which keeps chart tests
 * deterministic without a layout engine.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const apply = (next: number) => {
      // Ignore zero/NaN measurements (detached or display:none) so the chart
      // keeps its last good width instead of collapsing.
      if (Number.isFinite(next) && next > 0) setWidth(Math.round(next));
    };

    apply(el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        apply(entry.contentRect?.width ?? el.getBoundingClientRect().width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
