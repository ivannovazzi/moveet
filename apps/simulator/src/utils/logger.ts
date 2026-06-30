import { createModuleLoggerFactory } from "@moveet/server-kit";
import { parseLogLevel } from "./config";

const isDev = process.env.NODE_ENV !== "production";

// The level is validated/defaulted via the same zod schema field as the rest of
// the config (see parseLogLevel in config.ts), so an invalid LOG_LEVEL is still
// caught here. Secret redaction now comes from the shared server-kit factory
// (the simulator previously had none — see architecture review roadmap #6).
const { logger, child } = createModuleLoggerFactory({
  level: parseLogLevel(),
  pretty: isDev,
});

export const createLogger = (module: string) => child(module);

export default logger;
