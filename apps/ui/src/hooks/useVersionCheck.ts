import { useEffect } from "react";
import { toast } from "@/lib/toast";
import {
  currentBuildId,
  fetchDeployedBuildId,
  NEW_VERSION_MESSAGE,
  shouldNotifyUpdate,
  VERSION_POLL_INTERVAL_MS,
} from "@/lib/versionCheck";

export interface UseVersionCheckOptions {
  /** Poll period in ms. Defaults to 5 minutes. */
  intervalMs?: number;
  /**
   * Overrides the default enablement. Defaults to `!import.meta.env.DEV` —
   * in dev, Vite's HMR already replaces modules in place, so polling would be
   * pure noise (and `version.json` is not even emitted by the dev server).
   */
  enabled?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Polls the deployed `version.json` and, when the served build no longer
 * matches the one this tab is running, raises a single sonner toast offering a
 * reload. See `src/lib/versionCheck.ts` for why this works against a bare
 * static file server.
 *
 * Polling pauses while the tab is hidden (a background tab cannot act on the
 * prompt anyway) and runs one immediate check when it becomes visible again —
 * which is exactly when a user returns to a tab that has been open for hours.
 * After the prompt fires, polling stops for good: one nag is enough.
 */
export function useVersionCheck({
  intervalMs = VERSION_POLL_INTERVAL_MS,
  enabled,
  fetchImpl,
}: UseVersionCheckOptions = {}): void {
  const active = enabled ?? !import.meta.env.DEV;

  useEffect(() => {
    if (!active) return;
    const current = currentBuildId();
    // Unstamped bundle (dev server, tests): nothing meaningful to compare.
    if (!current) return;

    let cancelled = false;
    let notified = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const start = () => {
      if (timer === undefined) timer = setInterval(check, intervalMs);
    };

    async function check() {
      if (cancelled || notified || document.hidden) return;
      const deployed = await fetchDeployedBuildId(fetchImpl);
      if (cancelled || notified || !shouldNotifyUpdate(current, deployed)) return;
      notified = true;
      stop();
      toast.info(NEW_VERSION_MESSAGE, {
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      start();
      void check();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, intervalMs, fetchImpl]);
}
