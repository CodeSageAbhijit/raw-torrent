const timestamp = () => new Date().toISOString();

export const logger = {
  debug: (...args: unknown[]) => console.debug(`[${timestamp()}] DEBUG:`, ...args),
  info: (...args: unknown[]) => console.info(`[${timestamp()}] INFO:`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${timestamp()}] WARN:`, ...args),
  error: (...args: unknown[]) => console.error(`[${timestamp()}] ERROR:`, ...args),
};
