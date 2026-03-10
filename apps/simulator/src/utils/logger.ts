function readableDate(): string {
  // return in 'YYYY-MM-DD HH:mm:ss' format, no milliseconds
  return new Date().toISOString().replace("T", " ").replace(/\..+/, "");
}

// Custom logger wrapper
const logger = {
  info: (message: string): void => {
    console.log(`INFO @ ${readableDate()}: ${message}`);
  },
  error: (message: string): void => {
    console.log(`ERROR @ ${readableDate()}: ${message}`);
  },
  warn: (message: string): void => {
    console.log(`WARN @ ${readableDate()}: ${message}`);
  },
  debug: (message: string): void => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`DEBUG @ ${readableDate()}: ${message}`);
    }
  },
};

export default logger;
