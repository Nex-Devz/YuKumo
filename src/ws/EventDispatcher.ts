import type { EventName, EventCallback } from "../types/internal.ts";

type ListenerEntry = {
  callback: EventCallback<EventName>;
  once: boolean;
};

export class EventDispatcher {
  private readonly listenersMap = new Map<string, ListenerEntry[]>();

  /**
   * Called when a listener throws or returns a rejecting promise.
   * One bad listener still can't break the others, but the failure is
   * surfaced here instead of vanishing (or becoming an unhandled rejection).
   */
  public onListenerError?: (event: string, error: unknown) => void;

  public on<E extends EventName>(event: E, callback: EventCallback<E>): this {
    const entries = this.listenersMap.get(event) ?? [];
    entries.push({ callback: callback as EventCallback<EventName>, once: false });
    this.listenersMap.set(event, entries);
    return this;
  }

  public once<E extends EventName>(event: E, callback: EventCallback<E>): this {
    const entries = this.listenersMap.get(event) ?? [];
    entries.push({ callback: callback as EventCallback<EventName>, once: true });
    this.listenersMap.set(event, entries);
    return this;
  }

  public off<E extends EventName>(event: E, callback?: EventCallback<E>): this {
    if (callback === undefined) {
      this.listenersMap.delete(event);
      return this;
    }

    const entries = this.listenersMap.get(event);
    if (entries === undefined) return this;

    const filtered = entries.filter((e) => e.callback !== callback);
    if (filtered.length === 0) {
      this.listenersMap.delete(event);
    } else {
      this.listenersMap.set(event, filtered);
    }

    return this;
  }

  public emit<E extends EventName>(event: E, ...args: Parameters<EventCallback<E>>): void {
    const current = this.listenersMap.get(event);
    if (current === undefined) return;

    // Snapshot before iterating — a listener added or removed during this emit
    // must not be invoked (nor the live array mutated while it's being walked)
    const snapshot = current.slice();
    const toRemove: ListenerEntry[] = [];

    for (const entry of snapshot) {
      try {
        const result = (entry.callback as (...a: unknown[]) => unknown)(...args);
        if (result != null && typeof (result as Promise<unknown>).then === "function") {
          (result as Promise<unknown>).then(undefined, (error: unknown) => {
            this.onListenerError?.(event, error);
          });
        }
      } catch (error) {
        this.onListenerError?.(event, error);
      }

      if (entry.once) {
        toRemove.push(entry);
      }
    }

    if (toRemove.length > 0) {
      const live = this.listenersMap.get(event);
      if (live === undefined) return;
      const remaining = live.filter((e) => !toRemove.includes(e));
      if (remaining.length === 0) {
        this.listenersMap.delete(event);
      } else {
        this.listenersMap.set(event, remaining);
      }
    }
  }

  public removeAllListeners(): void {
    this.listenersMap.clear();
  }

  public listenerCount(event: EventName): number {
    return this.listenersMap.get(event)?.length ?? 0;
  }

  /** Alias for on (standard EventEmitter interface) */
  public addListener<E extends EventName>(event: E, callback: EventCallback<E>): this {
    return this.on(event, callback);
  }

  /** Alias for off (standard EventEmitter interface) */
  public removeListener<E extends EventName>(event: E, callback?: EventCallback<E>): this {
    return this.off(event, callback);
  }

  /** Returns an array listing the events for which the emitter has registered listeners */
  public eventNames(): EventName[] {
    return Array.from(this.listenersMap.keys()) as EventName[];
  }

  /** Returns a copy of the array of listeners for the event */
  public listeners<E extends EventName>(event: E): EventCallback<E>[] {
    return (this.listenersMap.get(event) ?? []).map((e) => e.callback as EventCallback<E>);
  }

  /** Returns a copy of the array of listeners for the event */
  public rawListeners<E extends EventName>(event: E): EventCallback<E>[] {
    return this.listeners(event);
  }

  private _maxListeners = 10;

  /** Standard EventEmitter setMaxListeners */
  public setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  /** Standard EventEmitter getMaxListeners */
  public getMaxListeners(): number {
    return this._maxListeners;
  }
}
