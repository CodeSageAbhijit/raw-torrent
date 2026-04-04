const timestamp = () => new Date().toISOString();

export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.LOG_LEVEL === "debug") {
      console.debug(`[${timestamp()}]`, ...args);
    }
  },
  info: (...args: unknown[]) => {
    console.log(`[${timestamp()}]`, ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(`[${timestamp()}]`, ...args);
  },
  error: (...args: unknown[]) => {
    console.error(`[${timestamp()}]`, ...args);
  },
};
