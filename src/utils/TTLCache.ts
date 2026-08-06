/**
 * Map with per-entry TTL. Entries expire lazily on access — no timers are
 * held, so the cache never keeps the process alive.
 */
export class TTLCache<K = string, V = unknown> {
  private readonly store = new Map<K, { value: V; expiresAt: number | null }>();

  /**
   * Stores a value. With `ttlMs`, the entry auto-expires after that many
   * milliseconds; without it, the entry lives until deleted.
   */
  public set(key: K, value: V, ttlMs?: number): this {
    this.store.set(key, {
      value,
      expiresAt: ttlMs != null && ttlMs > 0 ? Date.now() + ttlMs : null,
    });
    return this;
  }

  /** Gets a value, or undefined when missing or expired */
  public get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (entry == null) return undefined;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** True when the key exists and has not expired */
  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /** Deletes a key; returns true when it existed */
  public delete(key: K): boolean {
    return this.store.delete(key);
  }

  /** Removes all entries */
  public clear(): void {
    this.store.clear();
  }

  /** Number of live (non-expired) entries; sweeps expired ones as a side effect */
  public get size(): number {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt != null && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    return this.store.size;
  }
}
