import { createModuleLoggerFactory } from "@moveet/server-kit";

const isDev = process.env.NODE_ENV !== "production";

// Secret redaction (the safe-superset paths) is provided by the shared
// server-kit factory; the adapter keeps reading LOG_LEVEL the way it always
// has. See architecture review roadmap #6 (de-duplicated server runtime infra).
const { logger, child } = createModuleLoggerFactory({
  level: process.env.LOG_LEVEL ?? "info",
  pretty: isDev,
});

export const createLogger = (module: string) => child(module);

export default logger;
