export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_WEIGHT: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * A {@link Logger} that writes to the console. This is the one place in Yukumo
 * that is *meant* to touch the console, so the `no-console` rule is disabled
 * for its body — every other module logs through an injected {@link Logger}.
 */
/* eslint-disable no-console */
export class ConsoleLogger implements Logger {
  public debug(message: string, ...args: unknown[]): void {
    console.debug(`[DEBUG] ${message}`, ...args);
  }
  public info(message: string, ...args: unknown[]): void {
    console.info(`[INFO] ${message}`, ...args);
  }
  public warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }
  public error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }
}
/* eslint-enable no-console */

/** Logger that discards everything; the default when no logger is configured */
export class NoopLogger implements Logger {
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/** Wraps a logger so that messages below the configured level are dropped */
export function levelFilteredLogger(inner: Logger, level: LogLevel): Logger {
  if (level === "silent") return new NoopLogger();
  const threshold = LEVEL_WEIGHT[level];
  return {
    debug: (message, ...args) => {
      if (threshold <= LEVEL_WEIGHT.debug) inner.debug(message, ...args);
    },
    info: (message, ...args) => {
      if (threshold <= LEVEL_WEIGHT.info) inner.info(message, ...args);
    },
    warn: (message, ...args) => {
      if (threshold <= LEVEL_WEIGHT.warn) inner.warn(message, ...args);
    },
    error: (message, ...args) => {
      if (threshold <= LEVEL_WEIGHT.error) inner.error(message, ...args);
    },
  };
}
