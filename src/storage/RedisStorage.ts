import type { StorageAdapter } from "../types/internal.ts";
import { StorageError } from "../errors/index.ts";

export interface RedisStorageOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
  /** Default time-to-live for stored values in milliseconds; unset = keys never expire */
  ttlMs?: number;
}

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  exists(key: string): Promise<number>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string | string[]>;
  quit(): Promise<unknown>;
};

export class RedisStorage implements StorageAdapter {
  private client: RedisClient | null = null;
  private readonly options: RedisStorageOptions;
  private readonly prefix: string;

  public constructor(options?: RedisStorageOptions) {
    this.options = options ?? {};
    this.prefix = this.options.keyPrefix ?? "YuKumo:";
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  public async connect(): Promise<void> {
    if (this.client != null) return;

    try {
      const { createClient } = await import("redis");
      const redisOptions: Record<string, unknown> = {};

      if (this.options.url != null) {
        redisOptions.url = this.options.url;
      } else {
        redisOptions.socket = {
          host: this.options.host ?? "localhost",
          port: this.options.port ?? 6379,
        };
        if (this.options.password != null) {
          redisOptions.password = this.options.password;
        }
      }

      if (this.options.database != null) {
        redisOptions.database = this.options.database;
      }

      const client = createClient(redisOptions);
      await client.connect();
      this.client = client;
    } catch (error: unknown) {
      // Only a missing module gets the install hint — auth/network failures
      // must surface as themselves or they're impossible to debug
      const code = (error as { code?: string } | null)?.code;
      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        throw new StorageError(
          "The 'redis' package is not installed. Install it with: npm install redis",
          "REDIS_MODULE_MISSING",
          { cause: error },
        );
      }
      throw new StorageError(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`,
        "REDIS_CONNECT_FAILED",
        { cause: error },
      );
    }
  }

  private async ensureClient(): Promise<RedisClient> {
    if (this.client == null) {
      await this.connect();
    }
    return this.client!;
  }

  public requireClient(): RedisClient {
    if (this.client == null) {
      throw new StorageError("Redis not connected — call connect() first", "REDIS_NOT_CONNECTED");
    }
    return this.client;
  }

  public async get(key: string): Promise<unknown | null> {
    const client = await this.ensureClient();

    const value = await client.get(this.getKey(key));
    if (value == null) return null;

    try {
      return JSON.parse(value) as unknown;
    } catch {
      // All writes go through JSON.stringify, so an unparseable value is
      // corrupt — returning it raw would hand callers a string typed as their object
      return null;
    }
  }

  public async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const client = await this.ensureClient();

    const serialized = JSON.stringify(value);
    const effectiveTtl = ttlMs ?? this.options.ttlMs;
    if (effectiveTtl != null && effectiveTtl > 0) {
      await client.set(this.getKey(key), serialized, { PX: effectiveTtl });
    } else {
      await client.set(this.getKey(key), serialized);
    }
  }

  public async delete(key: string): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.del(this.getKey(key));
    return result > 0;
  }

  public async has(key: string): Promise<boolean> {
    const client = await this.ensureClient();
    const result = await client.exists(this.getKey(key));
    return result === 1;
  }

  public async clear(): Promise<void> {
    const client = await this.ensureClient();

    // Delete only keys under our prefix — FLUSHDB would wipe unrelated data
    // from applications sharing the same Redis database
    const batch: string[] = [];
    for await (const key of client.scanIterator({ MATCH: `${this.prefix}*`, COUNT: 250 })) {
      // node-redis v4 yields strings; v5 yields string arrays
      if (Array.isArray(key)) {
        batch.push(...key);
      } else {
        batch.push(key);
      }
      if (batch.length >= 250) {
        await client.del(batch.splice(0, batch.length));
      }
    }
    if (batch.length > 0) {
      await client.del(batch);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client != null) {
      await this.client.quit();
      this.client = null;
    }
  }
}
