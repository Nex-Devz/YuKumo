import { NodeManager } from "./node/NodeManager.ts";
import { PlayerManager } from "./player/PlayerManager.ts";
import { PluginManager } from "./plugins/PluginManager.ts";
import { EventDispatcher } from "./ws/EventDispatcher.ts";
import { MemoryStorage } from "./storage/MemoryStorage.ts";
import { VoiceStateTracker } from "./voice/VoiceStateTracker.ts";
import { SearchCache } from "./utils/SearchCache.ts";
import { levelFilteredLogger, NoopLogger, type Logger } from "./utils/Logger.ts";
import { PluginError } from "./errors/index.ts";
import type { Node } from "./node/Node.ts";
import type { Player } from "./player/Player.ts";
import type { Plugin } from "./plugins/Plugin.ts";
import type {
  NodeConfig,
  ManagerOptions,
  SearchOptions,
  SearchResult,
  StorageAdapter,
  VoiceStateUpdate,
  VoiceServerUpdate,
  VoiceGatewayPayload,
  EventName,
  EventCallback,
} from "./types/internal.ts";
import type { TrackData, LoadResult, LavaSearchType, LavaSearchResult } from "./types/protocol.ts";
import { LoadTypeMap } from "./types/constants.ts";

export interface YuKumoPlayerCreateOptions {
  guildId: string;
  voiceChannelId: string;
  textChannelId?: string;
  selfDeaf?: boolean;
  selfMute?: boolean;
  nodeId?: string;
}

function loadResultToSearchResult(result: LoadResult): SearchResult {
  switch (result.loadType) {
    case "track":
      return { loadType: "track", type: LoadTypeMap["track"], tracks: [result.data] };
    case "playlist":
      return {
        loadType: "playlist",
        type: LoadTypeMap["playlist"],
        tracks: result.data.tracks,
        playlistInfo: { name: result.data.info.name, selectedTrack: 0 },
      };
    case "search":
      return { loadType: "search", type: LoadTypeMap["search"], tracks: result.data };
    case "empty":
      return { loadType: "empty", type: LoadTypeMap["empty"], tracks: [] };
    case "error":
      return {
        loadType: "error",
        type: LoadTypeMap["error"],
        tracks: [],
        exception: {
          message: result.data.message,
          severity: result.data.severity,
          cause: result.data.cause,
        },
      };
  }
}

function formatSourcePrefix(source: string): string {
  const lower = source.toLowerCase().trim();
  const map: Record<string, string> = {
    youtube: "ytsearch",
    yt: "ytsearch",
    youtubemusic: "ytmsearch",
    ytm: "ytmsearch",
    soundcloud: "scsearch",
    sc: "scsearch",
    spotify: "spsearch",
    sp: "spsearch",
    applemusic: "amsearch",
    am: "amsearch",
    deezer: "dzsearch",
    dz: "dzsearch",
    yandex: "ymsearch",
    ym: "ymsearch",
  };
  if (map[lower]) return map[lower];
  if (lower.endsWith("search")) return lower;
  return `${source}search`;
}

function buildIdentifier(query: string, source?: string, defaultSearchSource: string = "ytsearch"): string {
  if (/^https?:\/\//i.test(query)) {
    return query;
  }
  if (/^[a-zA-Z0-9]+:/.test(query)) {
    return query;
  }
  if (source != null && source.trim() !== "") {
    const prefix = formatSourcePrefix(source);
    return `${prefix}:${query}`;
  }
  const defaultPrefix = formatSourcePrefix(defaultSearchSource);
  return `${defaultPrefix}:${query}`;
}

/**
 * Main Yukumo Lavalink Client. Coordinates Node pool load balancing, Player lifecycle,
 * Queue management, Filter chains, Plugins, and Voice state handling.
 */
export class YuKumo {
  public readonly nodes: NodeManager;
  public readonly players: PlayerManager;
  public readonly plugins: PluginManager;
  public readonly events: EventDispatcher;
  public readonly storage: StorageAdapter;
  public readonly voice: VoiceStateTracker;
  public readonly searchCache: SearchCache;
  public defaultSearchSource: string;
  /** Disconnect behavior configuration (see ManagerOptions.onDisconnect) */
  private readonly onDisconnect: { destroyPlayer: boolean; autoReconnect: boolean };
  /** User-provided Discord gateway dispatcher for OP4 voice payloads (see ManagerOptions.send) */
  public readonly sendGatewayPayload?: (guildId: string, payload: VoiceGatewayPayload) => void;
  /** Level-filtered logger for internal diagnostics (no-op unless configured) */
  public readonly logger: Logger;
  /** Voice connection timeout in milliseconds (default 15000) */
  public readonly voiceConnectionTimeout: number;
  /** Number of voice connection retry attempts before failing (default 0) */
  public readonly voiceConnectionRetries: number;
  private _userId: string;
  private readonly pendingPlayerCreates = new Map<string, Promise<Player>>();
  private readonly adapters = new Set<{ destroy(): void }>();

  public constructor(options: ManagerOptions) {
    this._userId = options.userId ?? "";
    this.sendGatewayPayload = options.send;
    this.logger =
      options.logger != null
        ? levelFilteredLogger(options.logger, options.logLevel ?? "warn")
        : new NoopLogger();
    this.defaultSearchSource = options.defaultSearchSource ?? "ytsearch";
    this.onDisconnect = {
      destroyPlayer: options.onDisconnect?.destroyPlayer ?? true,
      autoReconnect: options.onDisconnect?.autoReconnect ?? false,
    };
    this.storage = options.storageAdapter ?? new MemoryStorage();
    this.voiceConnectionTimeout = options.voiceConnectionTimeout ?? 15000;
    this.voiceConnectionRetries = options.voiceConnectionRetries ?? 0;
    this.events = new EventDispatcher();
    this.voice = new VoiceStateTracker(this.events);
    this.searchCache = new SearchCache();
    this.nodes = new NodeManager(this._userId);
    this.players = new PlayerManager(this);
    this.plugins = new PluginManager();
    this.plugins.onPluginError = (source, error) => {
      const message = `Plugin error in ${source}: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.warn(message);
      this.events.emit("debug", message);
    };
    this.events.onListenerError = (event, error) => {
      // Straight to the logger — re-emitting through the dispatcher could
      // recurse if the failing listener is itself on the debug event
      this.logger.error(
        `Unhandled error in "${event}" listener: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    };

    this.registerNodes(options.nodes);
    this.registerPlugins(options.plugins);
  }

  /** Registers an adapter for automatic listener teardown when this manager is destroyed */
  public registerAdapter(adapter: { destroy(): void }): void {
    this.adapters.add(adapter);
  }

  /** Sets the Discord Bot User ID for node handshakes */
  public setUserId(userId: string): void {
    this._userId = userId;
    this.nodes.setUserId(userId);
  }

  /** Gets the configured Discord Bot User ID */
  public get userId(): string {
    return this._userId;
  }

  /** Connects to all configured Lavalink nodes and starts plugins */
  public async init(): Promise<void> {
    await this.nodes.connectAll();
    await this.plugins.startAll();
  }

  /** Destroys all players, closes node WS connections, and cleans up event listeners, caches, and storage */
  public async destroy(): Promise<void> {
    for (const adapter of this.adapters) {
      try {
        adapter.destroy();
      } catch {
        // adapter teardown failures shouldn't block shutdown
      }
    }
    this.adapters.clear();
    await this.players.destroyAll();
    await this.nodes.destroyAll();
    await this.plugins.destroyAll();
    for (const guildId of this.voice.getAll().map((s) => s.guildId)) {
      this.voice.remove(guildId);
    }
    this.searchCache.clear();
    this.pendingPlayerCreates.clear();
    if (typeof this.storage.disconnect === "function") {
      try {
        await this.storage.disconnect();
      } catch {
        // storage teardown failures shouldn't block shutdown
      }
    }
    this.events.removeAllListeners();
  }

  /**
   * Searches for tracks across YouTube, Spotify, SoundCloud, or custom source managers.
   * @param queryOrOptions Search query string or options object
   * @param source Optional search source prefix (e.g. "youtube", "spotify")
   */
  public async search(queryOrOptions: string | SearchOptions, source?: string): Promise<SearchResult> {
    const resolved: SearchOptions =
      typeof queryOrOptions === "string" ? { query: queryOrOptions, source } : queryOrOptions;

    const hookResult = await this.plugins.runBeforeSearch(resolved.query, resolved.source);
    if (hookResult === null) {
      return { loadType: "empty", tracks: [] };
    }

    const identifier = buildIdentifier(hookResult.query, hookResult.source, this.defaultSearchSource);

    // Cache first — a hit needs no node, so don't waste a load-balancer pick
    // (and cached queries keep working while all nodes are down)
    const cached = this.searchCache.get<SearchResult>(identifier);
    if (cached != null) {
      return cached;
    }

    const nodeName = resolved.nodeName;
    const node = nodeName != null ? this.nodes.get(nodeName) : this.nodes.pick(resolved.query);
    if (node == null) {
      return { loadType: "empty", tracks: [] };
    }

    try {
      const result = await node.rest.loadTracks(identifier);
      const searchResult = loadResultToSearchResult(result);

      const afterResult = await this.plugins.runAfterSearch(searchResult);
      if (afterResult === null) {
        return { loadType: "empty", tracks: [] };
      }

      if (afterResult.loadType !== "error" && afterResult.loadType !== "empty") {
        this.searchCache.set(identifier, afterResult);
      }

      return afterResult;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        loadType: "error",
        tracks: [],
        exception: {
          message: errorMsg || "Failed to connect to Lavalink REST endpoint",
          severity: "fault",
          cause: String(err),
        },
      };
    }
  }

  /**
   * Performs a multi-category LavaSearch query across tracks, albums, artists, playlists, or text.
   * @param query Search query string
   * @param types Optional array of search result categories to filter by
   * @param nodeName Optional specific node name to use
   */
  public async lavaSearch(
    query: string,
    types?: LavaSearchType[],
    nodeName?: string,
  ): Promise<LavaSearchResult> {
    const cacheKey = `lava:${query}:${types?.join(",") ?? "all"}`;
    const cached = this.searchCache.get<LavaSearchResult>(cacheKey);
    if (cached != null) return cached;

    const node = nodeName != null ? this.nodes.get(nodeName) : this.nodes.pick(query);
    if (node == null) {
      return {};
    }
    try {
      const result = await node.rest.lavaSearch(query, types);
      this.searchCache.set(cacheKey, result);
      return result;
    } catch (err: unknown) {
      this.events.emit("debug", `lavaSearch failed: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }

  /**
   * Fetches lyrics for a specific track.
   * Note: This requires the Lavalink Lyrics plugin to be installed on the node.
   * @param encodedTrack The encoded track base64 string
   * @param nodeName Optional specific node name to use
   */
  public async getLyrics(encodedTrack: string, nodeName?: string): Promise<any> {
    const node = nodeName != null ? this.nodes.get(nodeName) : this.nodes.pick(encodedTrack);
    if (node == null) return null;
    try {
      return await node.rest.getLyrics(encodedTrack);
    } catch (err: unknown) {
      this.events.emit("debug", `getLyrics failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Creates or gets a player for a guild.
   * @param options Guild, channel IDs, and node options
   */
  public async createPlayer(options: YuKumoPlayerCreateOptions): Promise<Player> {
    const existing = this.players.get(options.guildId);
    if (existing != null) return existing;

    // Concurrent calls for the same guild await the same in-flight creation instead of
    // racing past the existence check (which would duplicate events and listeners)
    const pending = this.pendingPlayerCreates.get(options.guildId);
    if (pending != null) return pending;

    const creation = this.doCreatePlayer(options).finally(() => {
      this.pendingPlayerCreates.delete(options.guildId);
    });
    this.pendingPlayerCreates.set(options.guildId, creation);
    return creation;
  }

  private async doCreatePlayer(options: YuKumoPlayerCreateOptions): Promise<Player> {
    const hookResult = await this.plugins.runBeforeConnect(options.guildId, options.voiceChannelId);
    if (hookResult === null) {
      throw new PluginError(
        `Player creation for guild ${options.guildId} was cancelled by a plugin`,
        "YuKumo",
      );
    }

    const nodeId = options.nodeId;
    const node = nodeId != null ? this.nodes.get(nodeId) : this.nodes.pick(options.guildId);
    if (node == null) {
      throw new Error("No available nodes to create player");
    }

    const player = this.players.create({
      guildId: hookResult.guildId,
      node,
      voiceChannelId: hookResult.channelId,
      textChannelId: options.textChannelId,
      selfDeaf: options.selfDeaf,
      selfMute: options.selfMute,
    });

    const existingVoice = this.voice.getVoiceState(options.guildId);
    if (existingVoice != null) {
      player.setVoiceState(existingVoice);
      if (existingVoice.token && existingVoice.endpoint && existingVoice.sessionId) {
        await player.sendVoiceUpdate().catch(() => undefined);
      }
    }

    player.events.on("queueEnd", (guildId: string) => {
      this.events.emit("queueEnd", guildId);
      this.events.emit("playerEmpty" as EventName, guildId);
    });

    // Join the voice channel right away when the manager can dispatch OP4
    if (this.sendGatewayPayload != null) {
      player.connect();
    }

    this.events.emit("playerCreate", options.guildId);
    await this.plugins.runAfterConnect(options.guildId, options.voiceChannelId);

    return player;
  }

  /** Enqueues and starts track playback for a guild */
  public async play(guildId: string, track: TrackData): Promise<void> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);

    const hookResult = await this.plugins.runBeforePlay(guildId, track);
    if (hookResult === null) return;

    player.queue.enqueue(hookResult);
    if (player.status === "idle") {
      await player.play();
    }

    await this.plugins.runAfterPlay(guildId, hookResult);
  }

  /** Pauses player playback */
  public async pause(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);
    await player.pause();
  }

  /** Resumes player playback */
  public async resume(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);
    await player.resume();
  }

  /** Stops player playback */
  public async stop(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);
    await player.stop();
  }

  /**
   * Skips the currently playing track. Delegates to player.skip() so autoplay,
   * repeat handling, and queueEnd behave exactly like a natural track end.
   */
  public async skip(guildId: string): Promise<TrackData | null> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);

    return player.skip();
  }

  /** Plays the previous track in the queue history */
  public async playPrevious(guildId: string): Promise<TrackData | null> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);

    return await player.playPrevious();
  }

  /** Sets player volume */
  public async setVolume(guildId: string, volume: number): Promise<void> {
    const player = this.players.get(guildId);
    if (player == null) throw new Error(`No player found for guild ${guildId}`);
    await player.setVolume(volume);
  }

  /** Destroys player for a guild */
  public async destroyPlayer(guildId: string): Promise<boolean> {
    const shouldDestroy = await this.plugins.runBeforeDestroy(guildId);
    if (!shouldDestroy) return false;

    const result = await this.players.destroy(guildId);
    if (result) {
      this.events.emit("playerDestroy", guildId);
      await this.plugins.runAfterDestroy(guildId);
    }
    return result;
  }

  /** Processes raw Discord VOICE_STATE_UPDATE gateway event */
  public async handleVoiceStateUpdate(data: VoiceStateUpdate): Promise<void> {
    // Only the bot's own voice state matters — without this filter, any guild
    // member leaving voice would destroy the player and overwrite the session ID
    if (data.userId != null && this._userId !== "" && data.userId !== this._userId) {
      return;
    }

    this.voice.handleVoiceStateUpdate(data);

    const player = this.players.get(data.guildId);
    if (player == null) return;

    if (data.channelId == null) {
      await this.handleVoiceDisconnect(data.guildId, player);
      return;
    }

    if (player.voiceChannelId !== data.channelId) {
      const oldChannel = player.voiceChannelId;
      await player.setVoiceChannel(data.channelId);
      this.events.emit("playerMoved" as any, data.guildId, oldChannel, data.channelId);
    }

    player.updateVoiceState({ sessionId: data.sessionId, channelId: data.channelId });
    await player.sendVoiceUpdate().catch((err: unknown) => {
      this.events.emit(
        "debug",
        `Failed to push voice update for guild ${data.guildId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Handles the bot being disconnected from a voice channel per the
   * configured onDisconnect policy (autoReconnect wins over destroyPlayer).
   */
  private async handleVoiceDisconnect(guildId: string, player: Player): Promise<void> {
    this.events.emit("playerDisconnect" as EventName, guildId, "voiceChannelLeft");
    if (this.onDisconnect.autoReconnect && this.sendGatewayPayload != null) {
      const position = player.position;
      const paused = player.paused;
      const current = player.currentTrack;
      try {
        // Re-OP4 to rejoin; fresh credentials arrive via the adapters, and
        // playTrack awaits voice readiness before pushing the track
        player.connect();
        this.events.emit("debug", `Auto-reconnecting player for guild ${guildId}`);
        if (current != null) {
          await player.playTrack(current, { position });
          if (paused) await player.pause();
        }
        return;
      } catch (err: unknown) {
        this.events.emit(
          "debug",
          `Auto-reconnect failed for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.destroyPlayer(guildId);
        return;
      }
    }

    if (this.onDisconnect.destroyPlayer) {
      await this.destroyPlayer(guildId);
    }
  }

  /**
   * Processes a Discord CHANNEL_DELETE gateway event. Destroys the player when
   * its voice channel is deleted (there is nothing to stay connected to).
   */
  public async handleChannelDelete(guildId: string, channelId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player == null) return;
    if (player.voiceChannelId !== channelId) return;

    this.events.emit("debug", `Voice channel ${channelId} deleted, destroying player for guild ${guildId}`);
    await this.destroyPlayer(guildId);
  }

  /** Processes raw Discord VOICE_SERVER_UPDATE gateway event */
  public async handleVoiceServerUpdate(guildId: string, data: VoiceServerUpdate): Promise<void> {
    this.voice.handleVoiceServerUpdate(guildId, data);

    // Null endpoint = region failover in progress; keep current credentials
    // and wait for the follow-up update carrying the real endpoint
    if (data.endpoint == null) {
      this.events.emit("debug", `Voice server update for guild ${guildId} has no endpoint yet, holding`);
      return;
    }

    const player = this.players.get(guildId);
    if (player == null) return;

    player.updateVoiceState({ token: data.token, endpoint: data.endpoint });
    // Push fresh credentials immediately so region changes mid-playback don't kill audio
    await player.sendVoiceUpdate().catch((err: unknown) => {
      this.events.emit(
        "debug",
        `Failed to push voice update for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /** Gets player for a guild */
  public getPlayer(guildId: string): Player | undefined {
    return this.players.get(guildId);
  }

  /** Gets all active players */
  public getPlayers(): Player[] {
    return this.players.getAll();
  }

  /** Checks if player exists for a guild */
  public hasPlayer(guildId: string): boolean {
    return this.players.has(guildId);
  }

  /** Gets node by name or ID */
  public getNode(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  /** Gets all configured nodes */
  public getNodes(): Node[] {
    return this.nodes.getAll();
  }

  /** Alias for destroyPlayer — matches common wrapper naming */
  public async deletePlayer(guildId: string): Promise<boolean> {
    return this.destroyPlayer(guildId);
  }

  /** Returns true if any registered node is in "connected" state */
  public isUseable(): boolean {
    return this.nodes.some((n: Node) => n.state === "connected");
  }

  /** Alias for this.nodes — matches other wrappers' naming convention */
  public get nodeManager(): NodeManager {
    return this.nodes;
  }

  /** Subscribes to global client events */
  public on<E extends EventName>(event: E, callback: EventCallback<E>): this {
    this.events.on(event, callback);
    return this;
  }

  /** Subscribes to a global client event for a single emission */
  public once<E extends EventName>(event: E, callback: EventCallback<E>): this {
    this.events.once(event, callback);
    return this;
  }

  /** Unsubscribes a callback (or all callbacks when omitted) from a global client event */
  public off<E extends EventName>(event: E, callback?: EventCallback<E>): this {
    this.events.off(event, callback);
    return this;
  }

  private registerNodes(configs: NodeConfig[]): void {
    for (const config of configs) {
      const node = this.nodes.add(config);
      this.bindNodeEvents(node);
    }
  }

  private bindNodeEvents(node: Node): void {
    const ws = node.ws.eventDispatcher;
    ws.on("nodeReady", (nodeId: string) => {
      this.events.emit("nodeReady", nodeId);
      // A fresh (non-resumed) Lavalink session starts with zero players —
      // push each affected player's full state back or they stay silent forever
      if (!node.ws.resumed) {
        this.resyncPlayersOnNode(nodeId);
      }
    });
    ws.on("nodeDisconnected", (nodeId: string, code: number, reason: string) => {
      this.events.emit("nodeDisconnected", nodeId, code, reason);
      this.handleNodeFailover(nodeId);
    });
    ws.on("nodeReconnected", (nodeId: string) => this.events.emit("nodeReconnected", nodeId));
    ws.on("nodeError", (nodeId: string, error: Error) => this.events.emit("nodeError", nodeId, error));
    ws.on("stats", (nodeId: string, stats: unknown) => this.events.emit("stats", nodeId, stats as never));
    ws.on("debug", (msg: string) => this.events.emit("debug", msg));
    ws.on("socketClosed", (guildId: string, code: number, reason: string, byRemote: boolean) => {
      this.events.emit("socketClosed", guildId, code, reason, byRemote);
      this.handleVoiceSocketClosed(guildId, code);
    });
    ws.on("trackStart", (guildId: string, track: TrackData) =>
      this.events.emit("trackStart", guildId, track),
    );
    ws.on("trackEnd", (guildId: string, track: TrackData, reason: string) =>
      this.events.emit("trackEnd", guildId, track, reason),
    );
    ws.on("trackStuck", (guildId: string, track: TrackData, thresholdMs: number) =>
      this.events.emit("trackStuck", guildId, track, thresholdMs),
    );
    ws.on("trackException", (guildId: string, track: TrackData, exception: unknown) =>
      this.events.emit("trackException", guildId, track, exception),
    );
    ws.on(
      "playerUpdate",
      (guildId: string, state: { time: number; position: number; connected: boolean; ping: number }) =>
        this.events.emit("playerUpdate", guildId, state),
    );
  }

  /**
   * Reacts to Discord-side voice WebSocket closures reported by Lavalink.
   * 4015 (voice server crashed) and 4009 (session timed out) are recoverable
   * by re-sending OP4 to Discord and pushing fresh credentials to the node.
   */
  private handleVoiceSocketClosed(guildId: string, code: number): void {
    const player = this.players.get(guildId);
    if (player == null) return;

    if (code === 4015 || code === 4009) {
      this.logger.warn(`Voice socket closed for guild ${guildId} (code ${code}), rejoining channel`);
      // Re-OP4 triggers Discord to issue fresh VOICE_STATE/SERVER_UPDATE events,
      // which flow through the adapters back to sendVoiceUpdate()
      player.connect();
    }
  }

  private resyncPlayersOnNode(nodeId: string): void {    const affected = this.players.getAll().filter((p) => p.node.id === nodeId);
    for (const player of affected) {
      player.resync().catch((err: unknown) => {
        this.events.emit(
          "debug",
          `Failed to resync player for guild ${player.guildId} after node ${nodeId} reconnected: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  private handleNodeFailover(failedNodeId: string): void {
    const affectedPlayers = this.players.getAll().filter((p) => p.node.id === failedNodeId);
    for (const player of affectedPlayers) {
      const replacementNode = this.nodes.pick(player.guildId);
      if (replacementNode != null && replacementNode.id !== failedNodeId) {
        player.setNode(replacementNode).catch(() => {
          // failover migration error
        });
        this.events.emit("playerMove", player.guildId, failedNodeId, replacementNode.id);
      }
    }
  }

  private registerPlugins(
    pluginDefs?: Array<{
      name: string;
      version: string;
      init?(manager: unknown): void | Promise<void>;
      start?(): void | Promise<void>;
      destroy?(): void | Promise<void>;
    }>,
  ): void {
    if (pluginDefs == null) return;

    for (const def of pluginDefs) {
      const plugin: Plugin = {
        name: def.name,
        version: def.version,
        start: def.start,
        destroy: def.destroy,
      };
      this.plugins.register(plugin);
    }
  }
}
