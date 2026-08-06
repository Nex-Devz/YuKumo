import type { RepeatMode } from "../types/internal.ts";
import { QueueError, QueueFullError } from "../errors/index.ts";

export interface QueueOptions {
  /** Maximum number of tracks allowed in queue (0 for unlimited) */
  maxSize?: number;
  /** Maximum number of history items to store */
  maxHistorySize?: number;
}

export interface SerializedQueue<T> {
  tracks: T[];
  history: T[];
  currentIndex: number;
  repeatMode: RepeatMode;
}

/**
 * Type-safe, high-performance Queue manager supporting repeat modes, history,
 * serialization, shuffle, and priority insertion.
 */
export class Queue<T> {
  private readonly tracks: T[] = [];
  private readonly history: T[] = [];
  private currentIndex: number = -1;
  private _repeatMode: RepeatMode = "none";
  private readonly maxSize: number;
  private readonly maxHistorySize: number;

  /**
   * Invoked after any queue mutation (add/remove/advance/reorder/import).
   * Used by Player for queue persistence; also usable as a change watcher.
   */
  public onChanged?: () => void;

  /** Serializes lock() sections; mirrors Player's _trackEndChain pattern */
  private _lockChain: Promise<unknown> = Promise.resolve();
  private _lockDepth = 0;

  public constructor(options?: QueueOptions) {
    this.maxSize = options?.maxSize ?? 0;
    this.maxHistorySize = options?.maxHistorySize ?? 50;
  }

  private notifyChange(): void {
    try {
      this.onChanged?.();
    } catch {
      // watcher errors must not break queue operations
    }
  }

  /** Gets total number of tracks currently in the queue */
  public get size(): number {
    return this.tracks.length;
  }

  /** Checks whether the queue is empty */
  public get isEmpty(): boolean {
    return this.tracks.length === 0;
  }

  /** Gets current repeat mode ("none" | "track" | "queue") */
  public get repeatMode(): RepeatMode {
    return this._repeatMode;
  }

  /** Gets 0-based index of currently playing track in queue */
  public get currentIndexInQueue(): number {
    return this.currentIndex;
  }

  /** Gets currently active track or null */
  public get currentTrack(): T | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.tracks.length) {
      return null;
    }
    return this.tracks[this.currentIndex] as T;
  }

  /** Gets readonly array of all tracks in queue */
  public get tracksList(): readonly T[] {
    return this.tracks;
  }

  /** Alias for currentTrack — matches Erela.js/Poru convention */
  public get current(): T | null {
    return this.currentTrack;
  }

  /** Number of tracks in queue — Array.length convention alias for size */
  public get length(): number {
    return this.tracks.length;
  }

  /** Gets readonly array of played track history */
  public get historyList(): readonly T[] {
    return this.history;
  }

  /** Sets repeat mode ("none" | "track" | "queue") */
  public setRepeatMode(mode: RepeatMode): this {
    this._repeatMode = mode;
    return this;
  }

  /**
   * Enqueues a track at the end or specified index.
   * @param track Track object to append
   * @param index Optional position index
   */
  public enqueue(track: T, index?: number): this {
    if (this.maxSize > 0 && this.tracks.length >= this.maxSize) {
      throw new QueueFullError(this.maxSize);
    }

    if (index !== undefined && (index < 0 || index > this.tracks.length)) {
      throw new QueueError(`Index ${index} is out of bounds`);
    }

    if (index !== undefined) {
      this.tracks.splice(index, 0, track);
      if (this.currentIndex >= index) {
        this.currentIndex++;
      }
    } else {
      this.tracks.push(track);
    }

    this.notifyChange();
    return this;
  }

  /**
   * Enqueues a track at the top of the queue (immediately after current playing track).
   * @param track Track object to prioritize
   */
  public priorityEnqueue(track: T): this {
    const insertPos = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;
    return this.enqueue(track, insertPos);
  }

  /**
   * Dequeues a track at specified index or top of queue.
   * @param index Optional index to remove
   */
  public dequeue(index?: number): T | null {
    if (this.tracks.length === 0) return null;

    const removeIndex = index ?? 0;
    if (removeIndex < 0 || removeIndex >= this.tracks.length) return null;

    const [removed] = this.tracks.splice(removeIndex, 1) as [T];

    if (this.currentIndex === removeIndex) {
      this.currentIndex = -1;
    } else if (this.currentIndex > removeIndex) {
      this.currentIndex--;
    }

    this.notifyChange();
    return removed;
  }

  /**
   * Advances queue to next track based on current repeat mode.
   * In non-repeat-queue modes, consumed tracks are dropped from the queue
   * (history keeps the capped played list) so long-running queues can't grow unboundedly.
   * @param forceAdvance Skips repeat-track behavior — used when the current track failed
   * to load, so a broken track can't retry-loop forever
   */
  public next(forceAdvance: boolean = false): T | null {
    if (this.tracks.length === 0) return null;

    if (this._repeatMode === "track" && !forceAdvance && this.currentTrack != null) {
      return this.currentTrack;
    }

    this.addCurrentToHistory();

    if (this._repeatMode === "queue") {
      this.currentIndex = (this.currentIndex + 1) % this.tracks.length;
      this.notifyChange();
      return this.tracks[this.currentIndex] as T;
    }

    if (this.currentIndex >= 0) {
      this.tracks.splice(0, this.currentIndex + 1);
    }
    this.currentIndex = this.tracks.length > 0 ? 0 : -1;
    this.notifyChange();
    return this.currentTrack;
  }

  /**
   * Steps back to the previous track. History tracks are reinserted into the queue
   * at the current position so queue state and currentTrack stay consistent.
   */
  public previous(): T | null {
    const historyTrack = this.history.pop() ?? null;
    if (historyTrack != null) {
      const insertAt = this.currentIndex >= 0 ? this.currentIndex : 0;
      this.tracks.splice(insertAt, 0, historyTrack);
      this.currentIndex = insertAt;
      this.notifyChange();
      return historyTrack;
    }

    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.notifyChange();
      return this.tracks[this.currentIndex] as T;
    }

    return null;
  }

  /** Starts playback from first track in queue */
  public start(): T | null {
    if (this.tracks.length === 0) return null;
    this.currentIndex = 0;
    this.notifyChange();
    return this.tracks[0] as T;
  }

  /** Clears all tracks from queue */
  public clear(): void {
    this.tracks.length = 0;
    this.currentIndex = -1;
    this.notifyChange();
  }

  /** Clears track play history */
  public clearHistory(): void {
    this.history.length = 0;
    this.notifyChange();
  }

  /** Randomly shuffles queue tracks (excluding currently playing track) */
  public shuffle(): void {
    if (this.tracks.length <= 1) return;

    const startIdx = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;
    for (let i = this.tracks.length - 1; i > startIdx; i--) {
      const j = startIdx + Math.floor(Math.random() * (i - startIdx + 1));
      const temp = this.tracks[i] as T;
      this.tracks[i] = this.tracks[j] as T;
      this.tracks[j] = temp;
    }
    this.notifyChange();
  }

  /** Removes a range of tracks from queue */
  public remove(startIndex: number, deleteCount: number = 1): T[] {
    if (startIndex < 0 || startIndex >= this.tracks.length) return [];
    const removed = this.tracks.splice(startIndex, deleteCount);

    if (this.currentIndex >= startIndex + deleteCount) {
      this.currentIndex -= removed.length;
    } else if (this.currentIndex >= startIndex) {
      if (this.tracks.length === 0) {
        this.currentIndex = -1;
      } else if (startIndex < this.tracks.length) {
        this.currentIndex = startIndex;
      } else {
        this.currentIndex = this.tracks.length - 1;
      }
    }

    this.notifyChange();
    return removed;
  }

  /** Moves a track from one index position to another */
  public move(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.tracks.length || toIndex < 0 || toIndex >= this.tracks.length) {
      throw new QueueError(`Invalid move indices: ${fromIndex} -> ${toIndex}`);
    }

    if (fromIndex === toIndex) return;

    const [track] = this.tracks.splice(fromIndex, 1) as [T];
    this.tracks.splice(toIndex, 0, track);

    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < toIndex) {
      if (this.currentIndex > fromIndex && this.currentIndex <= toIndex) {
        this.currentIndex--;
      }
    } else {
      if (this.currentIndex >= toIndex && this.currentIndex < fromIndex) {
        this.currentIndex++;
      }
    }
    this.notifyChange();
  }

  /** Swaps two tracks at indexA and indexB in the queue */
  public swap(indexA: number, indexB: number): boolean {
    if (
      indexA < 0 ||
      indexA >= this.tracks.length ||
      indexB < 0 ||
      indexB >= this.tracks.length
    ) {
      return false;
    }
    if (indexA === indexB) return true;

    const temp = this.tracks[indexA] as T;
    this.tracks[indexA] = this.tracks[indexB] as T;
    this.tracks[indexB] = temp;

    if (this.currentIndex === indexA) {
      this.currentIndex = indexB;
    } else if (this.currentIndex === indexB) {
      this.currentIndex = indexA;
    }

    this.notifyChange();
    return true;
  }

  /**
   * Jumps directly to a specific track index in the queue.
   * In non-repeat-queue modes, preceding tracks up to index are added to history and dropped.
   * @param index 0-based track index
   */
  public skipTo(index: number): T | null {
    if (index < 0 || index >= this.tracks.length) return null;

    if (this._repeatMode === "queue") {
      this.currentIndex = index;
      this.notifyChange();
      return this.tracks[index] as T;
    }

    const removedCount = index;
    if (removedCount > 0) {
      const removedTracks = this.tracks.splice(0, removedCount);
      for (const track of removedTracks) {
        this.history.push(track);
        if (this.history.length > this.maxHistorySize) {
          this.history.shift();
        }
      }
    }

    this.currentIndex = 0;
    this.notifyChange();
    return this.tracks[0] as T;
  }

  /** Removes a slice of tracks starting from start index */
  public removeRange(start: number, count: number): T[] {
    return this.remove(start, count);
  }

  /** Alias for enqueue — matches common collection naming */
  public add(track: T, index?: number): this {
    return this.enqueue(track, index);
  }

  /** Alias for priorityEnqueue — inserts at front of queue */
  public unshift(track: T): this {
    return this.priorityEnqueue(track);
  }

  /** Alias for remove — splice semantics */
  public splice(start: number, deleteCount?: number): T[] {
    return this.remove(start, deleteCount);
  }

  /** Clears all tracks from queue except the currently playing track */
  public clearExceptCurrent(): void {
    const current = this.currentTrack;
    this.tracks.length = 0;
    if (current != null) {
      this.tracks.push(current);
      this.currentIndex = 0;
    } else {
      this.currentIndex = -1;
    }
    this.notifyChange();
  }

  /** Replaces queue tracks with a new list */
  public setTracks(tracks: T[]): void {
    this.tracks.length = 0;
    this.tracks.push(...tracks);
    this.currentIndex = this.tracks.length > 0 ? 0 : -1;
    this.notifyChange();
  }

  /**
   * Removes tracks by reference or matcher. Accepts a track object, an array
   * of track objects, or a predicate. Matches by identity first, then by
   * `encoded` string when present.
   */
  public removeTrack(query: T | T[] | ((track: T, index: number) => boolean)): T[] {
    const matches = (track: T, index: number): boolean => {
      if (typeof query === "function") {
        return (query as (t: T, i: number) => boolean)(track, index);
      }
      const list = Array.isArray(query) ? query : [query];
      return list.some((q) => {
        if (q === track) return true;
        const qEnc = (q as { encoded?: string })?.encoded;
        const tEnc = (track as { encoded?: string })?.encoded;
        return qEnc != null && qEnc === tEnc;
      });
    };

    const removed: T[] = [];
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      if (i === this.currentIndex) continue; // never remove the playing track here
      if (matches(this.tracks[i] as T, i)) {
        removed.push(...this.tracks.splice(i, 1));
        if (this.currentIndex > i) this.currentIndex--;
      }
    }
    if (removed.length > 0) this.notifyChange();
    return removed.reverse();
  }

  /**
   * Sorts upcoming tracks (after the current one) in place.
   * @param sortBy "duration" | "title" | "author" or a custom comparator
   * @param order "asc" (default) or "desc"
   */
  public sortBy(
    sortBy: "duration" | "title" | "author" | ((a: T, b: T) => number),
    order: "asc" | "desc" = "asc",
  ): this {
    const start = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;
    if (this.tracks.length - start <= 1) return this;

    const info = (t: T): { length?: number; title?: string; author?: string } =>
      (t as { info?: { length?: number; title?: string; author?: string } }).info ?? {};

    const comparator: (a: T, b: T) => number =
      typeof sortBy === "function"
        ? sortBy
        : sortBy === "duration"
          ? (a, b) => (info(a).length ?? 0) - (info(b).length ?? 0)
          : (a, b) => String(info(a)[sortBy] ?? "").localeCompare(String(info(b)[sortBy] ?? ""));

    const upcoming = this.tracks.splice(start);
    upcoming.sort((a, b) => (order === "desc" ? -comparator(a, b) : comparator(a, b)));
    this.tracks.push(...upcoming);
    this.notifyChange();
    return this;
  }

  /**
   * Runs `fn` exclusively — concurrent lock() calls queue up and execute one
   * at a time, so multi-step queue edits (add + shuffle, bulk remove) can't
   * interleave when several commands fire simultaneously.
   * Errors thrown by `fn` propagate to the caller but never break the chain.
   */
  public lock<R>(fn: () => R | Promise<R>): Promise<R> {
    const run = this._lockChain.then(async () => {
      this._lockDepth++;
      try {
        return await fn();
      } finally {
        this._lockDepth--;
      }
    });
    this._lockChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** True while a lock() section is currently executing */
  public get isLocked(): boolean {
    return this._lockDepth > 0;
  }

  /**
   * Removes duplicate tracks, keeping the first occurrence of each. The
   * currently playing track is never removed. Returns the removed tracks.
   * @param keyFn Custom identity — defaults to `encoded`, then `info.identifier`, then object identity
   */
  public unique(keyFn?: (track: T) => unknown): T[] {
    const keyOf =
      keyFn ??
      ((track: T): unknown => {
        const t = track as { encoded?: string; info?: { identifier?: string } };
        return t.encoded ?? t.info?.identifier ?? track;
      });

    const seen = new Set<unknown>();
    // Seed with the current track so duplicates of it elsewhere are dropped
    const current = this.currentTrack;
    if (current != null) seen.add(keyOf(current));

    const removed: T[] = [];
    for (let i = 0; i < this.tracks.length; i++) {
      if (i === this.currentIndex) continue; // never remove the playing track
      const key = keyOf(this.tracks[i] as T);
      if (seen.has(key)) {
        removed.push(...this.tracks.splice(i, 1));
        if (this.currentIndex > i) this.currentIndex--;
        i--;
      } else {
        seen.add(key);
      }
    }

    if (removed.length > 0) this.notifyChange();
    return removed;
  }

  /** Exports queue state for persistence or serialization */
  public export(): SerializedQueue<T> {
    return {
      tracks: [...this.tracks],
      history: [...this.history],
      currentIndex: this.currentIndex,
      repeatMode: this._repeatMode,
    };
  }

  /** Imports queue state from exported state */
  public import(state: SerializedQueue<T>): void {
    this.tracks.length = 0;
    this.tracks.push(...state.tracks);
    this.history.length = 0;
    this.history.push(...state.history);
    this.currentIndex = state.currentIndex;
    this._repeatMode = state.repeatMode;
    this.notifyChange();
  }

  private addCurrentToHistory(): void {
    if (this.currentIndex >= 0 && this.currentIndex < this.tracks.length) {
      this.history.push(this.tracks[this.currentIndex] as T);
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    }
  }

  /**
   * Returns a paginated slice of upcoming tracks in the queue.
   * @param page 1-based page number (default 1)
   * @param pageSize Number of items per page (default 10)
   */
  public getPage(
    page = 1,
    pageSize = 10,
  ): { tracks: T[]; page: number; totalPages: number; totalTracks: number } {
    const upcoming = this.tracks.slice(this.currentIndex + 1);
    const totalTracks = upcoming.length;
    const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
    const normalizedPage = Math.max(1, Math.min(page, totalPages));
    const start = (normalizedPage - 1) * pageSize;
    const paginatedTracks = upcoming.slice(start, start + pageSize);

    return {
      tracks: paginatedTracks,
      page: normalizedPage,
      totalPages,
      totalTracks,
    };
  }
}
