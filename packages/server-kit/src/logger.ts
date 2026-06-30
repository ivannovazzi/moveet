import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * The shared secret-redaction path set applied to EVERY server-kit logger.
 *
 * This is the safe superset: it keeps the adapter's original redaction paths
 * (`*.apiKey`, `*.password`, `*.token`, `*.secret`) so behavior there is
 * preserved, and applying it from the factory means the simulator (which
 * previously had NO redaction) now gets the same protection. Centralizing the
 * list removes the per-app drift the architecture review flagged.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  "*.apiKey",
  "*.password",
  "*.token",
  "*.secret",
];

export interface CreateLoggerOptions {
  /**
   * Pino log level. Each app validates its own `LOG_LEVEL` (e.g. via its zod
   * config) and passes the already-validated value in, so the factory does not
   * re-validate. Defaults to "info" when omitted.
   */
  level?: string;
  /**
   * When true (the default), use the `pino-pretty` transport for human-readable
   * colorized output. Apps pass `NODE_ENV !== "production"` here, matching the
   * previous per-app behavior.
   */
  pretty?: boolean;
  /**
   * Redaction paths. Defaults to {@link DEFAULT_REDACT_PATHS}. Pass extra paths
   * by spreading the default; pass `[]` only if you deliberately want none.
   */
  redact?: readonly string[];
  /**
   * Bindings merged into every log line of the root logger (e.g. `{ service }`).
   * Optional; preserves the previous behavior when omitted.
   */
  base?: Record<string, unknown>;
}

/**
 * Build the root pino logger shared by the Moveet services.
 *
 * Consolidates the two previously-duplicated `logger.ts` setups into one place
 * with CONSISTENT secret redaction. The caller supplies the (already-validated)
 * level and whether to pretty-print, keeping each app's config as the source of
 * truth for those values while the logging output shape stays equivalent.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { level = "info", pretty = false, redact = DEFAULT_REDACT_PATHS, base } = options;

  const pinoOptions: LoggerOptions = {
    level,
    redact: [...redact],
    transport: pretty ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  };

  if (base !== undefined) {
    // pino types `base` as `object | null`; `undefined` keeps pino's default.
    pinoOptions.base = base;
  }

  return pino(pinoOptions);
}

/**
 * Convenience factory matching the apps' historical `createLogger(module)`
 * shape: build a root logger once, then mint per-module child loggers from it.
 *
 * Returns both the root `logger` and a `child(module)` helper so an app can do:
 *
 *   const { logger, child } = createModuleLoggerFactory({ level, pretty });
 *   export default logger;
 *   export const createLogger = (module: string) => child(module);
 */
export function createModuleLoggerFactory(options: CreateLoggerOptions = {}): {
  logger: Logger;
  child: (module: string) => Logger;
} {
  const logger = createLogger(options);
  return {
    logger,
    child: (module: string) => logger.child({ module }),
  };
}

export type { Logger } from "pino";
