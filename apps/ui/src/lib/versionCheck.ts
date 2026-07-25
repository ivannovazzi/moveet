/**
 * Build-version detection for the deployed SPA.
 *
 * The UI ships as static hashed assets behind a bare Caddy `file_server`
 * (`try_files {path} /index.html`). `index.html` revalidates via Etag, but a
 * tab that is already open never re-fetches it, so after a redeploy that tab
 * keeps running the OLD hashed bundle until someone hard-refreshes. That has
 * already burned real debugging time (a stale bundle read as a render-perf
 * regression), so the app asks the server what it is currently serving.
 *
 * The mechanism is deliberately dumb: `vite.config.ts` stamps every build with
 * a `buildId`, bakes it into the bundle (`import.meta.env.VITE_BUILD_ID`) and
 * writes the same value to `dist/version.json`. Polling that file with
 * `cache: "no-store"` returns whatever is on disk right now — no server-side
 * support, no cache headers to configure, nothing Caddy has to know about.
 *
 * This module is pure/side-effect free; `useVersionCheck` owns the scheduling.
 */

/** Static file emitted alongside the hashed assets by the build-stamp plugin. */
export const VERSION_FILE = "version.json";

/** 5 minutes: often enough to catch a deploy, rare enough to be invisible. */
export const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export const NEW_VERSION_MESSAGE = "A new version of Moveet is available";

/** The build id baked into the bundle currently executing. */
export function currentBuildId(): string {
  const id: unknown = import.meta.env.VITE_BUILD_ID;
  return typeof id === "string" ? id : "";
}

/** Resolve `version.json` against the app's base path (usually `/`). */
export function versionUrl(base: string = import.meta.env.BASE_URL || "/"): string {
  return `${base.endsWith("/") ? base : `${base}/`}${VERSION_FILE}`;
}

/**
 * Read the build id the server is currently handing out.
 *
 * Returns `null` for every failure mode — offline, 404, or the SPA fallback
 * answering with `index.html` at 200 (HTML fails to parse as JSON). "Unknown"
 * must never be mistaken for "changed", so the caller stays silent on `null`.
 */
export async function fetchDeployedBuildId(
  fetchImpl: typeof fetch = globalThis.fetch,
  url: string = versionUrl()
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${url}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed: unknown = JSON.parse(await res.text());
    if (!parsed || typeof parsed !== "object") return null;
    const id = (parsed as { buildId?: unknown }).buildId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Whether the running bundle is stale. Both ids must be known: an unstamped
 * build (dev, or a test bundle) and an unreadable `version.json` both mean
 * "cannot tell", which is not the same as "out of date".
 */
export function shouldNotifyUpdate(current: string, deployed: string | null): boolean {
  if (!current || !deployed) return false;
  return current !== deployed;
}
