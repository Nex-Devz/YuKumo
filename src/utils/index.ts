export function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

export function promiseTimeout<T>(promise: Promise<T>, ms: number, errorMessage?: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      reject(new Error(errorMessage ?? `Promise timed out after ${ms}ms`));
    }, ms);
    if (typeof id === "object" && typeof id.unref === "function") {
      id.unref();
    }
  });

  return Promise.race([promise, timeout]);
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelay ?? 1000;
  const maxDelay = options?.maxDelay ?? 15000;
  const shouldRetry = options?.shouldRetry ?? ((_error: unknown) => true);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && shouldRetry(error)) {
        // Rate-limit errors carry the server-mandated wait; honor it exactly.
        // Otherwise use half-jittered exponential backoff to avoid retry waves.
        const retryAfter = (error as { retryAfter?: number } | null)?.retryAfter;
        const base = Math.min(baseDelay * 2 ** attempt, maxDelay);
        const delay = retryAfter != null && retryAfter > 0 ? retryAfter : base / 2 + Math.random() * (base / 2);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export function generateSnowflake(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
}

export function noop(): void {}

/**
 * Parses a lavalink connection URL of the form
 * `lavalink://<name>:<password>@<host>:<port>` (also accepts http/https/ws/wss,
 * where the scheme sets `secure`). Mirrors lavalink-client's parseLavalinkConnUrl.
 */
export function parseLavalinkConnUrl(connectionUrl: string): {
  name: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
} {
  const secure = /^(https|wss):\/\//i.test(connectionUrl);
  // Normalize to http:// so URL parsing never elides scheme-default ports
  // (wss://host:443 would otherwise report an empty port)
  const url = new URL(connectionUrl.replace(/^[a-z]+:\/\//i, "http://"));
  const port = url.port !== "" ? Number(url.port) : secure ? 443 : 80;
  if (!url.hostname || Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid lavalink connection url: ${connectionUrl}`);
  }
  return {
    name: decodeURIComponent(url.username) || url.hostname,
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port,
    secure,
  };
}

export function isPromise(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" && value !== null && typeof (value as Promise<unknown>).then === "function"
  );
}

export { type Logger, type LogLevel, ConsoleLogger, NoopLogger, levelFilteredLogger } from "./Logger.ts";
export * from "./SearchCache.ts";
export * from "./TTLCache.ts";
export * from "./Lyrics.ts";
export * from "./SponsorBlock.ts";
export * from "./UIHelpers.ts";
export * from "./Middleware.ts";
