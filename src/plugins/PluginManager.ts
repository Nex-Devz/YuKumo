import type { Plugin, LifecycleHookPipeline } from "./Plugin.ts";
import type { TrackData } from "../types/protocol.ts";
import type { SearchResult } from "../types/internal.ts";
import { PluginError } from "../errors/index.ts";

export class PluginManager {
  private readonly plugins: Map<string, Plugin> = new Map();
  private readonly hookHandlers: {
    [K in keyof Required<LifecycleHookPipeline>]: NonNullable<LifecycleHookPipeline[K]>[];
  } = {
    beforeSearch: [],
    afterSearch: [],
    beforeConnect: [],
    afterConnect: [],
    beforePlay: [],
    afterPlay: [],
    beforeDestroy: [],
    afterDestroy: [],
    onNodeSelect: [],
  };

  private readonly pendingInits: Promise<void>[] = [];

  /**
   * Called whenever a plugin init or lifecycle hook throws. YuKumo routes this
   * into its debug event stream; a failing hook is skipped instead of aborting
   * the core operation that triggered it.
   */
  public onPluginError?: (source: string, error: unknown) => void;

  public register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new PluginError(`Plugin "${plugin.name}" is already registered`, plugin.name);
    }

    this.plugins.set(plugin.name, plugin);

    if (plugin.init != null) {
      // Track the async init so failures surface through ready()/startAll()
      // instead of becoming unhandled rejections; a failed plugin is deregistered
      const initPromise = this.callInit(plugin).catch((error: unknown) => {
        this.plugins.delete(plugin.name);
        this.onPluginError?.(`init:${plugin.name}`, error);
        throw error;
      });
      initPromise.catch(() => {
        // handled via ready(); this guard prevents an unhandled rejection
      });
      this.pendingInits.push(initPromise);
    }
  }

  /** Resolves when all registered plugin inits have settled; throws the first init failure */
  public async ready(): Promise<void> {
    if (this.pendingInits.length === 0) return;
    const results = await Promise.allSettled(this.pendingInits);
    this.pendingInits.length = 0;
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure != null) {
      throw failure.reason;
    }
  }

  public unregister(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (plugin === undefined) return false;

    if (plugin.destroy != null) {
      this.callDestroy(plugin);
    }

    this.plugins.delete(name);
    return true;
  }

  public get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  public getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  public async startAll(): Promise<void> {
    await this.ready();
    for (const plugin of this.plugins.values()) {
      if (plugin.start != null) {
        try {
          await plugin.start();
        } catch (error) {
          throw new PluginError(
            `Plugin "${plugin.name}" failed to start: ${(error as Error).message}`,
            plugin.name,
            undefined,
            { cause: error },
          );
        }
      }
    }
  }

  public async destroyAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy != null) {
        try {
          await plugin.destroy();
        } catch {
          // ignore destroy errors
        }
      }
    }
    this.plugins.clear();
  }

  public addHook<K extends keyof LifecycleHookPipeline>(
    hook: K,
    handler: NonNullable<LifecycleHookPipeline[K]>,
  ): void {
    const handlers = this.hookHandlers[hook] as NonNullable<LifecycleHookPipeline[K]>[];
    handlers.push(handler);
  }

  public removeHook<K extends keyof LifecycleHookPipeline>(
    hook: K,
    handler: NonNullable<LifecycleHookPipeline[K]>,
  ): void {
    const handlers = this.hookHandlers[hook] as NonNullable<LifecycleHookPipeline[K]>[];
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Runs a single hook handler, isolating failures: a throwing handler is
   * reported via onPluginError and skipped so it can't abort the core
   * operation (play, destroy, connect) that triggered the pipeline.
   */
  private async runIsolated<R>(
    hook: string,
    fn: () => R | Promise<R>,
  ): Promise<{ ok: true; value: Awaited<R> } | { ok: false }> {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      this.onPluginError?.(hook, error);
      return { ok: false };
    }
  }

  public async runBeforeSearch(
    query: string,
    source?: string,
  ): Promise<{ query: string; source?: string } | null> {
    let current: { query: string; source?: string } = { query, source };
    for (const handler of this.hookHandlers.beforeSearch) {
      const result = await this.runIsolated("beforeSearch", () => handler(current.query, current.source));
      if (!result.ok) continue;
      if (result.value === null) return null;
      current = result.value;
    }
    return current;
  }

  public async runAfterSearch(result: SearchResult): Promise<SearchResult | null> {
    let current = result;
    for (const handler of this.hookHandlers.afterSearch) {
      const outcome = await this.runIsolated("afterSearch", () => handler(current));
      if (!outcome.ok) continue;
      if (outcome.value === null) return null;
      current = outcome.value;
    }
    return current;
  }

  public async runBeforeConnect(
    guildId: string,
    channelId: string,
  ): Promise<{ guildId: string; channelId: string } | null> {
    let current = { guildId, channelId };
    for (const handler of this.hookHandlers.beforeConnect) {
      const result = await this.runIsolated("beforeConnect", () =>
        handler(current.guildId, current.channelId),
      );
      if (!result.ok) continue;
      if (result.value === null) return null;
      current = result.value;
    }
    return current;
  }

  public async runAfterConnect(guildId: string, channelId: string): Promise<void> {
    for (const handler of this.hookHandlers.afterConnect) {
      await this.runIsolated("afterConnect", () => handler(guildId, channelId));
    }
  }

  public async runBeforePlay(guildId: string, track: TrackData): Promise<TrackData | null> {
    let current = track;
    for (const handler of this.hookHandlers.beforePlay) {
      const result = await this.runIsolated("beforePlay", () => handler(guildId, current));
      if (!result.ok) continue;
      if (result.value === null) return null;
      current = result.value;
    }
    return current;
  }

  public async runAfterPlay(guildId: string, track: TrackData): Promise<void> {
    for (const handler of this.hookHandlers.afterPlay) {
      await this.runIsolated("afterPlay", () => handler(guildId, track));
    }
  }

  public async runBeforeDestroy(guildId: string): Promise<boolean> {
    for (const handler of this.hookHandlers.beforeDestroy) {
      const result = await this.runIsolated("beforeDestroy", () => handler(guildId));
      if (!result.ok) continue;
      if (!result.value) return false;
    }
    return true;
  }

  public async runAfterDestroy(guildId: string): Promise<void> {
    for (const handler of this.hookHandlers.afterDestroy) {
      await this.runIsolated("afterDestroy", () => handler(guildId));
    }
  }

  public async runOnNodeSelect(guildId: string, availableNodes: string[]): Promise<string | null> {
    for (const handler of this.hookHandlers.onNodeSelect) {
      const result = await this.runIsolated("onNodeSelect", () => handler(guildId, availableNodes));
      if (!result.ok) continue;
      if (result.value != null) return result.value;
    }
    return null;
  }

  private async callInit(plugin: Plugin): Promise<void> {
    try {
      await plugin.init!();
    } catch (error) {
      throw new PluginError(
        `Plugin "${plugin.name}" failed to initialize: ${(error as Error).message}`,
        plugin.name,
        undefined,
        { cause: error },
      );
    }
  }

  private async callDestroy(plugin: Plugin): Promise<void> {
    try {
      await plugin.destroy!();
    } catch {
      // ignore destroy errors
    }
  }
}
