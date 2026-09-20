import type { SearchResult } from "../types/internal.ts";
import type { LavaSearchResult } from "../types/protocol.ts";

export interface CacheOptions {
  /** Maximum number of entries to keep in cache (default: 100) */
  maxSize?: number;
  /** Time to live in milliseconds (default: 1 hour) */
  ttl?: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * High-performance LRU cache for search results.
 */
export class SearchCache {
  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly cache = new Map<string, CacheEntry<SearchResult | LavaSearchResult>>();

  public constructor(options?: CacheOptions) {
    this.maxSize = options?.maxSize ?? 100;
    this.ttl = options?.ttl ?? 3600000;
  }

  /**
   * Retrieves a cached result if it exists and is not expired.
   * @param key The unique cache key (e.g. search query)
   */
  public get<T extends SearchResult | LavaSearchResult>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data as T;
  }

  /**
   * Caches a search result.
   * @param key The unique cache key
   * @param data The result to cache
   */
  public set(key: string, data: SearchResult | LavaSearchResult): void {
    // Only evict when inserting a genuinely new key at capacity —
    // overwriting an existing key doesn't grow the map
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey != null) {
        this.cache.delete(oldestKey);
      }
    }

    // Delete-then-set refreshes the key's LRU position on overwrite
    this.cache.delete(key);
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * Clears all cached results.
   */
  public clear(): void {
    this.cache.clear();
  }
}
