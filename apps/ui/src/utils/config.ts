/**
 * Validated environment configuration for the UI.
 *
 * All VITE_* env vars are declared here with types, defaults, and validation.
 * Invalid values cause a hard failure at module load time so mis-configurations
 * are caught immediately during development or build.
 */

function requireUrl(value: string | undefined, name: string, fallback: string): string {
  const resolved = value || fallback;
  try {
    new URL(resolved);
  } catch {
    throw new Error(
      `Invalid URL for ${name}: "${resolved}". ` +
        `Provide a valid URL (e.g. "${fallback}").`
    );
  }
  return resolved;
}

/** Validated, immutable app config derived from Vite env vars. */
export const config = Object.freeze({
  /** Base URL for the simulator REST API */
  apiUrl: requireUrl(
    import.meta.env.VITE_API_URL,
    "VITE_API_URL",
    "http://localhost:5010"
  ),

  /** WebSocket URL for real-time simulator updates */
  wsUrl: requireUrl(
    import.meta.env.VITE_WS_URL,
    "VITE_WS_URL",
    "ws://localhost:5010"
  ),

  /** Base URL for the adapter REST API */
  adapterUrl: requireUrl(
    import.meta.env.VITE_ADAPTER_URL,
    "VITE_ADAPTER_URL",
    "http://localhost:5011"
  ),
});

export type AppConfig = typeof config;
