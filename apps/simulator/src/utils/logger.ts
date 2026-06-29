import pino from "pino";
import { parseLogLevel } from "./config";

const isDev = process.env.NODE_ENV !== "production";

const logger = pino({
  // Validated/defaulted via the same zod schema field as the rest of the
  // config (see parseLogLevel in config.ts), so an invalid LOG_LEVEL is caught.
  level: parseLogLevel(),
  transport: isDev ? { target: "pino-pretty", options: { colorize: true } } : undefined,
});

export const createLogger = (module: string) => logger.child({ module });

export default logger;
