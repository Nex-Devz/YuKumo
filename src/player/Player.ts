import type { Node } from "../node/Node.ts";
import { Queue, type SerializedQueue } from "../queue/Queue.ts";
import { FilterChain } from "../filters/FilterChain.ts";
import type { TrackData, PlayerState } from "../types/protocol.ts";
import type { InternalVoiceState, RepeatMode } from "../types/internal.ts";
import { PlayerNotConnectedError, PlayerError } from "../errors/index.ts";
import { EventDispatcher } from "../ws/EventDispatcher.ts";
import type { EventName, EventCallback } from "../types/internal.ts";
import { DestroyReasons } from "../types/constants.ts";

import type { YuKumo } from "../Kumo.ts";
import type { SearchResult } from "../types/internal.ts";

export type PlayerStatus = "idle" | "playing" | "paused" | "destroyed";

/** Options accepted by play()/playTrack() — mapped onto the Lavalink player PATCH */
export interface PlayOptions {
  /** Start position in milliseconds */
  position?: number;
  /** Stop playback at this track position in milliseconds */
  endTime?: number | null;
  /** If true, the node ignores the request when a track is already playing */
  noReplace?: boolean;
  /** Start paused */
  paused?: boolean;
  /** Volume to apply with this play request (0-1000) */
  volume?: number;
}

/** Serializable snapshot of the full player state */
export interface PlayerJson {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string | null;
  status: PlayerStatus;
  paused: boolean;
  volume: number;
  position: number;
  repeatMode: RepeatMode;
  autoplay: boolean;
  stayInVc: boolean;
  nodeId: string;
  queue: SerializedQueue<TrackData>;
  filters: Record<string, unknown>;
  voiceState: InternalVoiceState;
}

export interface PlayerOptions {
  /** Target Discord Guild ID */
  guildId: string;
  /** Active Lavalink Node connection */
  node: Node;
  /** Discord Voice Channel ID */
  voiceChannelId: string;
  /** Optional Discord Text Channel ID */
  textChannelId?: string;
  /** Initial self deaf status */
  selfDeaf?: boolean;
  /** Initial self mute status */
  selfMute?: boolean;
  /** Whether to keep the player connected to voice channel when queue ends (24/7 mode) */
  stayInVc?: boolean;
  /** Timeout in ms to auto-pause or auto-disconnect when VC is empty (0 to disable) */
  emptyVcTimeoutMs?: number;
  /** Whether to pause playback instead of disconnecting when VC is empty */
  pauseWhenEmpty?: boolean;
  /** Destroy the player when more than maxAmount track errors occur within threshold ms (null disables) */
  maxErrorsPerTime?: { threshold: number; maxAmount: number } | null;
  /** Minimum ms the last track must have played before error-triggered autoplay runs (0 disables) */
  minAutoPlayMs?: number;
  /** Destroy the player this many ms after the queue ends (0 disables; stayInVc overrides) */
  queueEmptyDestroyMs?: number;
  /** Persist the queue to the manager's storage adapter on every change */
  persistQueue?: boolean;
  /** Persist full player state (position, volume, filters, flags) for restart resuming */
  persistState?: boolean;
  /** Enable source-aware autoplay from creation */
  autoplay?: boolean;
  /** Reference to the main YuKumo client */
  kumo: YuKumo;
}

/**
 * Manages audio playback, filters, and voice state for a single Discord Guild.
 */
export class Player<TTrack extends TrackData = TrackData> {
  public readonly guildId: string;
  public readonly queue: Queue<TTrack>;
  public readonly filters: FilterChain;
  public readonly events: EventDispatcher;
  
  /** Custom data map for developers to store persistent session variables */
  public readonly data: Map<string, any> = new Map();

  /** Whether autoplay is enabled when queue ends */
  public autoplay: boolean = false;
  /** Custom autoplay recommendation fetcher hook */
  public autoplayFetcher?: (lastTrack: TTrack) => Promise<TTrack | null>;

  /** Whether to remain in VC when queue ends (24/7 mode) */
  public stayInVc: boolean = false;
  /** Timeout in ms before auto-disconnecting or auto-pausing on empty VC */
  public emptyVcTimeoutMs: number = 0;
  /** Whether to pause instead of disconnect when VC is empty */
  public pauseWhenEmpty: boolean = false;
  /** Error-rate protection: destroy when more than maxAmount errors occur within threshold ms */
  public maxErrorsPerTime: { threshold: number; maxAmount: number } | null = null;
  /** Minimum ms the last track must have played before error-triggered autoplay runs */
  public minAutoPlayMs: number = 0;
  /** Destroy the player this many ms after the queue ends (0 disables) */
  public queueEmptyDestroyMs: number = 0;

  private emptyVcTimer: ReturnType<typeof setTimeout> | null = null;
  private queueEmptyTimer: ReturnType<typeof setTimeout> | null = null;
  private _errorTimestamps: number[] = [];
  private _lastTrackStartTs: number = 0;
  private _lavalinkPing: number | null = null;
  private _persistQueue: boolean = false;
  private _queueSaveScheduled: boolean = false;
  private _persistState: boolean = false;
  private _stateSaveScheduled: boolean = false;

  private _node: Node;
  private readonly kumo: YuKumo;
  private _status: PlayerStatus = "idle";
  private _position: number = 0;
  /** Wall-clock time of the last position sync, for interpolation between playerUpdates */
  private _positionTimestamp: number = 0;
  private _volume: number = 100;
  private _voiceChannelId: string;
  private _textChannelId: string | null;
  private _voiceState: InternalVoiceState = {
    sessionId: null,
    channelId: null,
    endpoint: null,
    token: null,
  };
  private _voiceStateSent: boolean = false;
  private _paused: boolean = false;
  private _destroyed: boolean = false;
  private _selfDeaf: boolean;
  private _selfMute: boolean;
  private voiceReadyWaiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private readonly boundOnTrackEnd = (guildId: string, track: TrackData, reason: string) => {
    if (guildId !== this.guildId) return;
    this.events.emit("trackEnd", guildId, track, reason);
    if (reason === "loadFailed" && this.registerTrackError("error")) return;
    if (reason === "finished" || reason === "loadFailed") {
      this.queueTrackEndTask(track as TTrack, reason).catch(() => undefined);
    }
  };

  private readonly boundOnTrackStart = (guildId: string, track: TrackData) => {
    if (guildId !== this.guildId) return;
    this._status = "playing";
    this._paused = false;
    this._lastTrackStartTs = Date.now();
    this.cancelQueueEmptyDestroy();
    this.scheduleStateSave();
    this.events.emit("trackStart", guildId, track);
  };

  private readonly boundOnTrackStuck = (guildId: string, track: TrackData, thresholdMs: number) => {
    if (guildId !== this.guildId) return;
    this.events.emit("trackStuck", guildId, track, thresholdMs);
    if (this.registerTrackError("stuck")) return;
    this.queueTrackEndTask(track as TTrack, "stuck").catch(() => undefined);
  };

  private readonly boundOnPlayerUpdate = (guildId: string, state: PlayerState) => {
    if (guildId !== this.guildId) return;
    this._position = state.position;
    this._positionTimestamp = Date.now();
    if (typeof state.ping === "number" && state.ping >= 0) {
      this._lavalinkPing = state.ping;
    }
    // Keeps the persisted position fresh (~5s granularity) for restart resuming
    this.scheduleStateSave();
    this.events.emit("playerUpdate", guildId, state as never);
  };

  private readonly boundOnTrackException = (guildId: string, track: TrackData, exception: unknown) => {
    if (guildId !== this.guildId) return;
    this.events.emit("trackException", guildId, track, exception);
    this.registerTrackError("error");
  };

  /** Guild-scoped plugin events (SponsorBlock, LavaLyrics) re-emitted on player.events */
  private static readonly pluginEventNames = [
    "segmentsLoaded",
    "segmentSkipped",
    "chaptersLoaded",
    "chapterStarted",
    "lyricsFound",
    "lyricsNotFound",
    "lyricsLine",
    "mixStarted",
    "mixEnded",
  ] as const;

  private readonly boundPluginForwarders = new Map<string, (...args: unknown[]) => void>();

  /**
   * Sliding-window error-rate protection. Returns true when the limit was hit
   * and the player is being destroyed — callers must stop advancing the queue.
   */
  private registerTrackError(kind: "error" | "stuck"): boolean {
    const cfg = this.maxErrorsPerTime;
    if (cfg == null || cfg.maxAmount <= 0 || cfg.threshold <= 0) return false;

    const now = Date.now();
    this._errorTimestamps.push(now);
    this._errorTimestamps = this._errorTimestamps.filter((t) => now - t <= cfg.threshold);
    if (this._errorTimestamps.length <= cfg.maxAmount) return false;

    const reason =
      kind === "stuck"
        ? DestroyReasons.TrackStuckMaxTracksErroredPerTime
        : DestroyReasons.TrackErrorMaxTracksErroredPerTime;
    this.events.emit(
      "debug",
      `Player ${this.guildId} exceeded ${cfg.maxAmount} track errors within ${cfg.threshold}ms — destroying (${reason})`,
    );
    this.destroy(reason).catch(() => undefined);
    return true;
  }

  public constructor(options: PlayerOptions) {
    this.guildId = options.guildId;
    this._node = options.node;
    this.kumo = options.kumo;
    this._voiceChannelId = options.voiceChannelId;
    this._textChannelId = options.textChannelId ?? null;
    this._selfDeaf = options.selfDeaf ?? true;
    this._selfMute = options.selfMute ?? false;
    this.stayInVc = options.stayInVc ?? false;
    this.emptyVcTimeoutMs = options.emptyVcTimeoutMs ?? 0;
    this.pauseWhenEmpty = options.pauseWhenEmpty ?? false;
    this.maxErrorsPerTime = options.maxErrorsPerTime !== undefined ? options.maxErrorsPerTime : null;
    this.minAutoPlayMs = options.minAutoPlayMs ?? 0;
    this.queueEmptyDestroyMs = options.queueEmptyDestroyMs ?? 0;
    this.queue = new Queue<TTrack>();
    this.filters = new FilterChain();
    this.events = new EventDispatcher();

    this.autoplay = options.autoplay ?? false;

    this.setupNodeListeners();
    if (options.persistQueue === true) {
      this.enableQueuePersistence();
    }
    if (options.persistState === true) {
      this.enableStatePersistence();
    }
  }

  /** Gets active Lavalink Node */
  public get node(): Node {
    return this._node;
  }

  /** Gets current player status ("idle" | "playing" | "paused" | "destroyed") */
  public get status(): PlayerStatus {
    return this._status;
  }

  /**
   * Gets current playback position in milliseconds. Lavalink only pushes
   * position every ~5s, so while playing (and not paused) the value is
   * interpolated from the last sync, clamped to the track length when known.
   */
  public get position(): number {
    if (this._status !== "playing" || this._paused || this._positionTimestamp === 0) {
      return this._position;
    }
    const estimated = this._position + (Date.now() - this._positionTimestamp);
    const length = this.queue.currentTrack?.info?.length;
    return typeof length === "number" && length > 0 ? Math.min(estimated, length) : estimated;
  }

  /** Gets current player volume (0 to 1000) */
  public get volume(): number {
    return this._volume;
  }

  /** Gets whether playback is paused */
  public get paused(): boolean {
    return this._paused;
  }

  /** Gets active voice channel ID */
  public get voiceChannelId(): string {
    return this._voiceChannelId;
  }

  /** Gets active text channel ID */
  public get textChannelId(): string | null {
    return this._textChannelId;
  }

  /** Alias for voiceChannelId — matches Shoukaku/Erela convention */
  public get voiceId(): string {
    return this._voiceChannelId;
  }

  /** Sets voice channel ID — alias setter for voiceId */
  public set voiceId(id: string) {
    this._voiceChannelId = id;
  }

  /** Alias for textChannelId — matches Shoukaku/Erela convention */
  public get textId(): string | null {
    return this._textChannelId;
  }

  /** Sets text channel ID — alias setter for textId */
  public set textId(id: string | null) {
    this._textChannelId = id;
  }

  /** Whether the player has voice credentials and its node is connected */
  public get connected(): boolean {
    return this.hasVoiceCredentials && this._node.state === "connected";
  }

  /** Alias for this.filters (FilterChain instance) — matches other wrappers' naming */
  public get filterManager(): FilterChain {
    return this.filters;
  }

  /** Gets current voice connection parameters */
  public get voiceState(): InternalVoiceState {
    return { ...this._voiceState };
  }

  /** Gets currently playing track object or null */
  public get currentTrack(): TTrack | null {
    return this.queue.currentTrack;
  }

  private setupNodeListeners(): void {
    const ws = this._node.ws.eventDispatcher;
    ws.on("trackEnd", this.boundOnTrackEnd as never);
    ws.on("trackStart", this.boundOnTrackStart as never);
    ws.on("trackStuck", this.boundOnTrackStuck as never);
    ws.on("trackException", this.boundOnTrackException as never);
    ws.on("playerUpdate", this.boundOnPlayerUpdate as never);
    for (const name of Player.pluginEventNames) {
      const forwarder = (guildId: string, ...rest: unknown[]): void => {
        if (guildId !== this.guildId) return;
        (this.events.emit as (...a: unknown[]) => void)(name, guildId, ...rest);
      };
      this.boundPluginForwarders.set(name, forwarder as (...args: unknown[]) => void);
      ws.on(name as never, forwarder as never);
    }
  }

  private removeNodeListeners(): void {
    const ws = this._node.ws.eventDispatcher;
    ws.off("trackEnd", this.boundOnTrackEnd as never);
    ws.off("trackStart", this.boundOnTrackStart as never);
    ws.off("trackStuck", this.boundOnTrackStuck as never);
    ws.off("trackException", this.boundOnTrackException as never);
    ws.off("playerUpdate", this.boundOnPlayerUpdate as never);
    for (const [name, forwarder] of this.boundPluginForwarders) {
      ws.off(name as never, forwarder as never);
    }
    this.boundPluginForwarders.clear();
  }

  /** Consecutive queue-advance failures; guards against retry-looping a dead node or all-broken queue */
  private _advanceFailures = 0;

  /**
   * Serializes track-end handling. Natural ends, stuck tracks, and skips can
   * otherwise interleave their async handling and double-advance the queue.
   */
  private _trackEndChain: Promise<void> = Promise.resolve();

  private queueTrackEndTask(lastTrack: TTrack | null, reason: string): Promise<void> {
    const run = this._trackEndChain.then(() => {
      if (this._destroyed) return;
      return this.handleTrackEnd(lastTrack, reason);
    });
    this._trackEndChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handleTrackEnd(lastTrack: TTrack | null, reason: string): Promise<void> {
    if (this._destroyed) return;

    // A track that failed to load must not be repeated, or repeat-track mode
    // would hammer the node with the same broken track forever; explicit skips
    // advance past repeat-track too
    const forceAdvance = reason === "loadFailed" || reason === "stuck" || reason === "skipped";
    const nextTrack = this.queue.next(forceAdvance);
    if (nextTrack != null) {
      try {
        await this.playTrack(nextTrack);
        this._advanceFailures = 0;
        return;
      } catch (error) {
        this._advanceFailures++;
        this.events.emit(
          "debug",
          `Failed to start next track in guild ${this.guildId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (this._advanceFailures < 3) {
          // Skip the broken track and try the one after it
          return this.handleTrackEnd(nextTrack, "loadFailed");
        }
        this._advanceFailures = 0;
        // Too many consecutive failures — fall through to autoplay/queueEnd
      }
    }

    // After an error end, require the track to have played at least minAutoPlayMs
    // before autoplay kicks in — otherwise a broken source spams recommendations
    const errorEnd = reason === "loadFailed" || reason === "stuck";
    const autoplayBlocked =
      errorEnd &&
      this.minAutoPlayMs > 0 &&
      this._lastTrackStartTs > 0 &&
      Date.now() - this._lastTrackStartTs < this.minAutoPlayMs;

    // lastTrack is null when skip() fires with nothing playing — no seed for recommendations
    if (this.autoplay && lastTrack != null && !autoplayBlocked) {
      try {
        let autoTrack: TTrack | null = null;
        if (this.autoplayFetcher != null) {
          autoTrack = await this.autoplayFetcher(lastTrack);
        } else {
          autoTrack = await this.resolveAutoplayTrack(lastTrack);
        }

        if (autoTrack != null) {
          this.queue.enqueue(autoTrack);
          this.events.emit("autoplayTrackAdded", this.guildId, autoTrack);
          const trackToPlay = this.queue.next() ?? autoTrack;
          await this.playTrack(trackToPlay);
          return;
        }
      } catch (error) {
        this.events.emit(
          "debug",
          `Autoplay failed in guild ${this.guildId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this._status = "idle";
    this._paused = false;
    this.events.emit("queueEnd", this.guildId);
    this.scheduleQueueEmptyDestroy();
  }

  /** Destroys the player after queueEmptyDestroyMs of an ended queue (24/7 mode wins) */
  private scheduleQueueEmptyDestroy(): void {
    if (this.queueEmptyDestroyMs <= 0 || this.stayInVc || this._destroyed) return;
    this.cancelQueueEmptyDestroy();
    this.queueEmptyTimer = setTimeout(() => {
      this.queueEmptyTimer = null;
      if (this._destroyed || this._status === "playing") return;
      this.destroy(DestroyReasons.QueueEmpty).catch(() => undefined);
    }, this.queueEmptyDestroyMs);
    (this.queueEmptyTimer as { unref?: () => void }).unref?.();
  }

  private cancelQueueEmptyDestroy(): void {
    if (this.queueEmptyTimer != null) {
      clearTimeout(this.queueEmptyTimer);
      this.queueEmptyTimer = null;
    }
  }

  /** Gets whether autoplay is currently enabled */
  public isAutoplayEnabled(): boolean {
    return this.autoplay;
  }

  /** Identifiers of recently played tracks — used to keep autoplay from repeating itself */
  private recentTrackIdentifiers(limit: number = 20): Set<string> {
    const ids = new Set<string>();
    const history = this.queue.historyList;
    for (const track of history.slice(Math.max(0, history.length - limit))) {
      const id = (track as TrackData).info?.identifier;
      if (id) ids.add(id);
    }
    const currentId = this.currentTrack?.info?.identifier;
    if (currentId) ids.add(currentId);
    return ids;
  }

  /** Picks the first candidate track not in the exclude set (falls back to the first candidate) */
  private pickAutoplayCandidate(
    result: import("../types/protocol.ts").LoadResult,
    exclude: Set<string>,
  ): TTrack | null {
    let candidates: TrackData[] = [];
    if (result.loadType === "playlist") candidates = result.data.tracks;
    else if (result.loadType === "search") candidates = result.data;
    else if (result.loadType === "track") candidates = [result.data];
    if (candidates.length === 0) return null;

    const fresh = candidates.find((t) => {
      const id = t.info?.identifier;
      return id != null && !exclude.has(id);
    });
    return (fresh ?? null) as TTrack | null;
  }

  /**
   * Built-in source-aware autoplay. Builds a prioritized list of
   * recommendation identifiers for the track's own source (YouTube RD mix,
   * Spotify `sprec`, Deezer `dzrec`, Yandex `ymrec`, SoundCloud related), then
   * falls back to a plain search on the artist + title — so autoplay works for
   * every source, not just YouTube. Recently played tracks are excluded.
   * Used when no custom `autoplayFetcher` is set; also callable directly.
   */
  public async resolveAutoplayTrack(lastTrack: TTrack): Promise<TTrack | null> {
    const info = lastTrack.info ?? ({} as NonNullable<TTrack["info"]>);
    const source = (info.sourceName ?? "").toLowerCase();
    const identifier = info.identifier;
    const exclude = this.recentTrackIdentifiers();
    if (identifier) exclude.add(identifier);

    const attempts: string[] = [];
    switch (source) {
      case "youtube":
      case "youtubemusic":
        if (identifier) {
          attempts.push(`https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`);
        }
        break;
      case "spotify":
        if (identifier) attempts.push(`sprec:seed_tracks=${identifier}`);
        break;
      case "deezer":
        if (identifier) attempts.push(`dzrec:${identifier}`);
        break;
      case "yandexmusic":
        if (identifier) attempts.push(`ymrec:${identifier}`);
        break;
      case "soundcloud":
        if (info.uri) attempts.push(`${info.uri.replace(/\/+$/, "")}/recommended`);
        break;
    }

    // Universal fallback: search the same artist across the default source
    const query = `${info.author ?? ""} ${info.title ?? ""}`.trim();
    if (query !== "") {
      if (source === "soundcloud") attempts.push(`scsearch:${query}`);
      if (source === "applemusic") attempts.push(`amsearch:${query}`);
      attempts.push(`ytsearch:${query}`);
    }

    for (const attempt of attempts) {
      try {
        const result = await this._node.rest.loadTracks(attempt);
        const picked = this.pickAutoplayCandidate(result, exclude);
        if (picked != null) return picked;
      } catch {
        // recommendation prefix unsupported on this node — try the next strategy
      }
    }
    return null;
  }

  /** Fetches synced lyrics for current playing track or specified track via LRCLIB */
  public async getSyncedLyrics(track?: TTrack): Promise<import("../utils/Lyrics.ts").LyricsResult | null> {
    const targetTrack = track ?? this.currentTrack;
    if (!targetTrack?.info) return null;
    const { LyricsClient } = await import("../utils/Lyrics.ts");
    const client = new LyricsClient();
    return client.getLyrics(
      targetTrack.info.title ?? "",
      targetTrack.info.author ?? "",
      undefined,
      targetTrack.info.length ? Math.round(targetTrack.info.length / 1000) : undefined,
    );
  }

  /** Sets whether to remain connected to voice channel when queue ends (24/7 mode) */
  public setStayInVc(enabled: boolean): this {
    this.stayInVc = enabled;
    return this;
  }

  /** Updates member count in player voice channel to manage auto-disconnect/pause timers */
  public setVcMemberCount(count: number): void {
    if (this.emptyVcTimeoutMs <= 0) return;

    if (count <= 1) {
      if (this.emptyVcTimer == null) {
        this.emptyVcTimer = setTimeout(() => {
          this.emptyVcTimer = null;
          if (this.pauseWhenEmpty && this._status === "playing") {
            this.pause().catch(() => undefined);
            this.events.emit("playerAutoPaused", this.guildId);
          } else if (!this.stayInVc) {
            this.events.emit("playerAutoDisconnected", this.guildId);
            this.destroy(DestroyReasons.EmptyVoiceChannel).catch(() => undefined);
          }
        }, this.emptyVcTimeoutMs);
        // Don't let an idle-VC countdown keep the process alive
        (this.emptyVcTimer as { unref?: () => void }).unref?.();
      }
    } else {
      if (this.emptyVcTimer != null) {
        clearTimeout(this.emptyVcTimer);
        this.emptyVcTimer = null;
      }
    }
  }

  /** Subscribes to player events */
  public on<E extends EventName>(event: E, callback: EventCallback<E>): this {
    this.events.on(event, callback);
    return this;
  }

  /** Subscribes to a player event for a single emission */
  public once<E extends EventName>(event: E, callback: EventCallback<E>): this {
    this.events.once(event, callback);
    return this;
  }

  /** Unsubscribes a callback (or all callbacks when omitted) from a player event */
  public off<E extends EventName>(event: E, callback?: EventCallback<E>): this {
    this.events.off(event, callback);
    return this;
  }

  /**
   * Skips the current track, advancing through the same path as a natural
   * track end — so autoplay, repeat handling, and queueEnd all still fire.
   * Returns the track now playing, or null if the queue ended.
   */
  public async skip(): Promise<TTrack | null> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const skipped = this.currentTrack;
    await this.stop();
    await this.queueTrackEndTask(skipped, "skipped");
    return this.currentTrack;
  }

  /** Reassigns player to a new Lavalink node (for node failover / load balancing) */
  public async setNode(node: Node): Promise<void> {
    const oldNode = this._node;
    this.removeNodeListeners();
    this._node = node;
    this.setupNodeListeners();
    oldNode.playerCount = Math.max(0, oldNode.playerCount - 1);
    node.playerCount += 1;

    // The new node's session has never seen this player's voice credentials
    this._voiceStateSent = false;

    if (this._status === "playing" && this.currentTrack != null) {
      await this.playTrack(this.currentTrack, { position: this.position });
    } else {
      // Not playing — still register the player (voice + volume/filters) on the new node
      await this.resync().catch(() => undefined);
    }
  }


  /** Plays the previous track from the queue history */
  public async playPrevious(): Promise<TTrack | null> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const previous = this.queue.previous();
    if (previous == null) return null;

    await this.playTrack(previous);
    return previous;
  }

  /**
   * Shortcut to search for tracks using the main YuKumo instance.
   * @param query Search query
   * @param source Optional search source (e.g. ytsearch, scsearch)
   */
  public search(query: string, source?: string): Promise<SearchResult> {
    return this.kumo.search(query, source);
  }

  /**
   * Sets the queue repeat mode.
   * @param mode "none", "track", or "queue"
   */
  public setLoop(mode: "none" | "track" | "queue"): this {
    this.queue.setRepeatMode(mode);
    this.scheduleStateSave();
    return this;
  }

  /** Unified pause/resume toggle — matches Erela.js/Magmastream convention */
  public async setPaused(state: boolean): Promise<void> {
    return state ? this.pause() : this.resume();
  }

  /** Alias for setNode — moves player to a different Lavalink node */
  public async move(node: Node): Promise<void> {
    return this.setNode(node);
  }

  /** Convenience wrapper for setVoiceChannel with options object */
  public async setVoice(options: {
    voiceId: string;
    selfDeaf?: boolean;
    selfMute?: boolean;
  }): Promise<void> {
    return this.setVoiceChannel(options.voiceId, {
      selfDeaf: options.selfDeaf,
      selfMute: options.selfMute,
    });
  }

  /**
   * Fetches lyrics for the current track or a specified track using Lavalink Lyrics plugin.
   * @param encodedTrack Optional encoded track. Defaults to the currently playing track.
   */
  public async getLyrics(encodedTrack?: string | null): Promise<any> {
    const trackToUse = encodedTrack ?? this.queue.currentTrack?.encoded;
    if (!trackToUse) return null;
    return this.kumo.getLyrics(trackToUse);
  }

  /**
   * Sets SponsorBlock categories to auto-skip (requires the SponsorBlock
   * plugin on the node). Emits segmentsLoaded/segmentSkipped/chapterStarted/
   * chaptersLoaded events on this player.
   */
  public async setSponsorBlock(categories: string[] = ["sponsor", "selfpromo"]): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    await this._node.rest.setSponsorBlockCategories(this._node.rest.sessionId, this.guildId, categories);
  }

  /** Gets the SponsorBlock categories configured for this player on the node */
  public async getSponsorBlock(): Promise<string[]> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    return this._node.rest.getSponsorBlockCategories(this._node.rest.sessionId, this.guildId);
  }

  /** Clears the SponsorBlock categories for this player on the node */
  public async deleteSponsorBlock(): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    await this._node.rest.deleteSponsorBlockCategories(this._node.rest.sessionId, this.guildId);
  }

  /** Fetches lyrics of the currently playing track via the node's LavaLyrics plugin */
  public async getCurrentLyrics(skipTrackSource: boolean = false): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    return this._node.rest.getCurrentLyrics(this._node.rest.sessionId, this.guildId, skipTrackSource);
  }

  /**
   * Subscribes to live lyrics for this guild — the node then emits
   * lyricsFound/lyricsNotFound/lyricsLine events (LavaLyrics plugin required).
   */
  public async subscribeLyrics(skipTrackSource: boolean = false): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    await this._node.rest.subscribeLyrics(this._node.rest.sessionId, this.guildId, skipTrackSource);
  }

  /** Unsubscribes from live lyrics events for this guild */
  public async unsubscribeLyrics(): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    await this._node.rest.unsubscribeLyrics(this._node.rest.sessionId, this.guildId);
  }

  /**
   * Moves the player to another node. Without an id, picks the connected node
   * with the fewest players (excluding the current one).
   */
  public async moveNode(nodeId?: string): Promise<Node> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    let target: Node | undefined;
    if (nodeId != null) {
      target = this.kumo.nodes.get(nodeId);
      if (target == null) throw new PlayerError(`Node "${nodeId}" does not exist`, this.guildId);
    } else {
      target = this.kumo.nodes
        .getAll()
        .filter((n) => n.state === "connected" && n.id !== this._node.id)
        .sort((a, b) => a.playerCount - b.playerCount)[0];
      if (target == null) throw new PlayerError("No eligible node to move to", this.guildId);
    }

    if (target.id === this._node.id) return this._node;
    await this.setNode(target);
    return target;
  }

  /** Latest measured latencies: node WS ping and per-player Lavalink ping */
  public get ping(): { ws: number | null; lavalink: number | null } {
    return { ws: this._node.ping, lavalink: this._lavalinkPing };
  }

  /** Serializes the complete player state (queue, filters, voice, playback) */
  public toJSON(): PlayerJson {
    return {
      guildId: this.guildId,
      voiceChannelId: this._voiceChannelId,
      textChannelId: this._textChannelId,
      status: this._status,
      paused: this._paused,
      volume: this._volume,
      position: this.position,
      repeatMode: this.queue.repeatMode,
      autoplay: this.autoplay,
      stayInVc: this.stayInVc,
      nodeId: this._node.id,
      queue: this.queue.export() as SerializedQueue<TrackData>,
      filters: this.filters.toPayload() as Record<string, unknown>,
      voiceState: this.voiceState,
    };
  }

  private get queueStorageKey(): string {
    return `yukumo:queue:${this.guildId}`;
  }

  private get stateStorageKey(): string {
    return `yukumo:player:${this.guildId}`;
  }

  /**
   * Persists the queue to the manager's storage adapter on every mutation
   * (microtask-coalesced), enabling queue restore across restarts.
   */
  public enableQueuePersistence(): void {
    if (this.kumo?.storage == null) return;
    this._persistQueue = true;
    this.syncQueueChangedHook();
  }

  /**
   * Persists the full player snapshot (queue, position, volume, filters,
   * repeat/autoplay/24-7 flags) so a restarted bot can rebuild this player and
   * keep playing. Saved on track start, every playerUpdate, queue mutations,
   * and playback-affecting setters; coalesced per microtask.
   */
  public enableStatePersistence(): void {
    if (this.kumo?.storage == null) return;
    this._persistState = true;
    this.syncQueueChangedHook();
    this.scheduleStateSave();
  }

  /** Queue mutations feed both persistence layers when enabled */
  private syncQueueChangedHook(): void {
    this.queue.onChanged = () => {
      if (this._persistQueue) this.scheduleQueueSave();
      if (this._persistState) this.scheduleStateSave();
    };
  }

  private scheduleStateSave(): void {
    if (!this._persistState || this._destroyed || this._stateSaveScheduled) return;
    this._stateSaveScheduled = true;
    queueMicrotask(() => {
      this._stateSaveScheduled = false;
      if (this._destroyed) return;
      void this.saveState().catch(() => undefined);
    });
  }

  /** Writes the current full player snapshot to the storage adapter immediately */
  public async saveState(): Promise<void> {
    if (this.kumo?.storage == null) return;
    try {
      await this.kumo.storage.set(this.stateStorageKey, this.toJSON());
    } catch (err) {
      this.events.emit(
        "debug",
        `Failed to persist player state for guild ${this.guildId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Applies a persisted snapshot to this (freshly created) player: queue,
   * volume, repeat mode, autoplay, 24/7 flag, filters, position, and pause
   * state. Does not touch the node — callers decide whether to adopt a live
   * session or re-send the play request.
   */
  public restoreFromState(state: PlayerJson): void {
    if (state.queue != null) {
      this.queue.import(state.queue as SerializedQueue<TTrack>);
    }
    this._volume = state.volume ?? this._volume;
    this.queue.setRepeatMode(state.repeatMode ?? "none");
    this.autoplay = state.autoplay ?? this.autoplay;
    this.stayInVc = state.stayInVc ?? this.stayInVc;
    this._textChannelId = state.textChannelId ?? this._textChannelId;
    this._paused = state.paused ?? false;
    this._position = state.position ?? 0;
    this._positionTimestamp = 0;
    if (state.filters != null && Object.keys(state.filters).length > 0) {
      this.filters.apply(state.filters as import("../types/protocol.ts").FiltersObject);
    }
  }

  /**
   * Adopts a still-live server-side player after a resumed Lavalink session —
   * the node kept playing through the restart, so only internal state is
   * synchronized and no play request is sent (audio never stops).
   */
  public adoptLiveState(live: import("../types/protocol.ts").PlayerData): void {
    if (live.track != null) {
      const current = this.currentTrack;
      if (current == null || current.encoded !== live.track.encoded) {
        // Restored queue diverged from what the node is actually playing —
        // trust the node
        this.queue.priorityEnqueue(live.track as TTrack);
        this.queue.start();
      }
      this._status = live.paused ? "paused" : "playing";
      this._lastTrackStartTs = Date.now();
    } else {
      this._status = "idle";
    }
    this._paused = live.paused;
    this._volume = live.volume;
    this._position = live.state?.position ?? 0;
    this._positionTimestamp = Date.now();
    // The resumed session already holds working voice credentials — pushing
    // our stale pre-restart ones would kill the live connection
    this._voiceStateSent = true;
  }

  private scheduleQueueSave(): void {
    if (!this._persistQueue || this._destroyed || this._queueSaveScheduled) return;
    this._queueSaveScheduled = true;
    queueMicrotask(() => {
      this._queueSaveScheduled = false;
      if (this._destroyed) return;
      void Promise.resolve(this.kumo.storage.set(this.queueStorageKey, this.queue.export())).catch(
        (err: unknown) => {
          this.events.emit(
            "debug",
            `Failed to persist queue for guild ${this.guildId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    });
  }

  /** Restores a previously persisted queue from the storage adapter. Returns true when restored. */
  public async restoreQueue(): Promise<boolean> {
    if (this.kumo?.storage == null) return false;
    try {
      const stored = await this.kumo.storage.get(this.queueStorageKey);
      if (stored == null) return false;
      this.queue.import(stored as SerializedQueue<TTrack>);
      return true;
    } catch (err) {
      this.events.emit(
        "debug",
        `Failed to restore queue for guild ${this.guildId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** Whether complete voice credentials (token + endpoint + sessionId) are held */
  public get hasVoiceCredentials(): boolean {
    return (
      this._voiceState.token != null &&
      this._voiceState.token !== "" &&
      this._voiceState.endpoint != null &&
      this._voiceState.endpoint !== "" &&
      this._voiceState.sessionId != null &&
      this._voiceState.sessionId !== ""
    );
  }

  /**
   * Resolves once complete voice credentials are available (both Discord voice
   * gateway events processed), so playback isn't sent to Lavalink before the
   * voice connection can exist. Resolves immediately when credentials are
   * already held; rejects after `timeoutMs` (default 15000) otherwise.
   */
  public waitForVoiceReady(timeoutMs: number = 15000): Promise<void> {
    if (this._destroyed) {
      return Promise.reject(new PlayerError("Player is destroyed", this.guildId));
    }
    if (this.hasVoiceCredentials || !this.kumo?.events) return Promise.resolve();

    // Credentials may already be sitting in the global tracker (e.g. player
    // recreated while the bot never left the channel)
    const globalVoice = this.kumo?.voice?.getVoiceState(this.guildId);
    if (globalVoice != null && globalVoice.token && globalVoice.endpoint && globalVoice.sessionId) {
      this.setVoiceState(globalVoice);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.voiceReadyWaiters = this.voiceReadyWaiters.filter((w) => w !== waiter);
          reject(
            new PlayerNotConnectedError(
              this.guildId,
              `Voice connection was not established within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs),
      };
      (waiter.timer as { unref?: () => void }).unref?.();
      this.voiceReadyWaiters.push(waiter);
    });
  }

  private settleVoiceReadyWaiters(error?: Error): void {
    if (this.voiceReadyWaiters.length === 0) return;
    const waiters = this.voiceReadyWaiters;
    this.voiceReadyWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (error != null) {
        waiter.reject(error);
      } else {
        waiter.resolve();
      }
    }
  }

  /**
   * Begins playback of the given track. If none provided, plays next in queue.
   */
  public async play(track?: TrackData, options?: PlayOptions): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const trackToPlay = (track as TTrack) ?? this.queue.currentTrack ?? this.queue.start();
    if (trackToPlay == null) {
      throw new PlayerError("No tracks in queue", this.guildId);
    }

    await this.playTrack(trackToPlay, options);
  }

  /** Plays a specific track directly */
  public async playTrack(track: TTrack, options?: PlayOptions): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const filterPayload = this.filters.toPayload();
    const hasFilterKeys = Object.keys(filterPayload).length > 0;

    // Claim "playing" synchronously so a second play() racing this one
    // sees a non-idle status instead of starting a duplicate playback
    const previousStatus = this._status;
    this._status = "playing";

    try {
      const sessionId = this._node.rest.sessionId;
      if (sessionId == null) {
        throw new PlayerNotConnectedError(this.guildId);
      }

      if (!this.hasVoiceCredentials) {
        const globalVoice = this.kumo?.voice?.getVoiceState(this.guildId);
        if (globalVoice != null) {
          this.setVoiceState(globalVoice);
        }
      }

      // Don't race Discord's voice handshake: a track PATCH sent before the
      // voice credentials reach Lavalink plays nothing and reports no error
      if (!this.hasVoiceCredentials) {
        await this.waitForVoiceReady();
      }

      await this.sendVoiceUpdate();

      const volume = options?.volume != null ? Math.max(0, Math.min(1000, options.volume)) : this._volume;
      const paused = options?.paused ?? this._paused;

      await this._node.rest.updatePlayer(
        sessionId,
        this.guildId,
        {
          track: { encoded: track.encoded },
          position: options?.position,
          endTime: options?.endTime,
          volume,
          paused,
          filters: hasFilterKeys ? filterPayload : undefined,
        },
        options?.noReplace ?? false,
      );
      this._volume = volume;
      this._paused = paused;
      this._position = options?.position ?? 0;
      this._positionTimestamp = Date.now();
      this.cancelQueueEmptyDestroy();
    } catch (error) {
      this._status = previousStatus === "playing" ? "idle" : previousStatus;
      throw error;
    }
  }

  /** Stops playback for current track */
  public async stop(): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      track: { encoded: null },
    });

    this._status = "idle";
    this._paused = false;
    this._position = 0;
    this._positionTimestamp = Date.now();
  }

  /** Pauses current track playback (no-op when already paused) */
  public async pause(): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    if (this._paused) return;

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    // Freeze the interpolated position before flipping the paused flag
    const frozenPosition = this.position;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      paused: true,
    });

    this._position = frozenPosition;
    this._positionTimestamp = Date.now();
    this._paused = true;
    if (this._status === "playing") {
      this._status = "paused";
    }
    this.scheduleStateSave();
  }

  /** Resumes paused track playback (no-op when not paused) */
  public async resume(): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    if (!this._paused) return;

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      paused: false,
    });

    this._paused = false;
    this._positionTimestamp = Date.now();
    if (this._status === "paused") {
      this._status = "playing";
    }
    this.scheduleStateSave();
  }

  /**
   * Sets player volume (0 to 1000). The value is remembered even while the
   * node session is unavailable and applied on the next playTrack().
   */
  public async setVolume(volume: number): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const clamped = Math.max(0, Math.min(1000, volume));
    this._volume = clamped;

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      volume: clamped,
    });
    this.scheduleStateSave();
  }

  /** Seeks to position in track (milliseconds), clamped to [0, track length] */
  public async seek(position: number): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);

    const length = this.queue.currentTrack?.info?.length;
    const target = Math.max(
      0,
      typeof length === "number" && length > 0 ? Math.min(position, length) : position,
    );

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      position: target,
    });

    this._position = target;
    this._positionTimestamp = Date.now();
  }

  /** Applies current filter chain payload to Lavalink node in real time */
  public async setFilters(filters?: FilterChain): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    if (filters != null) {
      this.filters.apply(filters.toPayload());
    }

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      filters: this.filters.toPayload(),
    });
  }

  /** Clears all applied filters and updates Lavalink node in real time */
  public async clearFilters(): Promise<void> {
    this.filters.clear();
    await this.setFilters();
  }

  /** Toggles the nightcore filter preset */
  public async setNightcore(enabled: boolean = true): Promise<void> {
    this.filters.setNightcore(enabled);
    await this.setFilters();
  }

  /** Toggles the vaporwave filter preset */
  public async setVaporwave(enabled: boolean = true): Promise<void> {
    this.filters.setVaporwave(enabled);
    await this.setFilters();
  }

  /** Sets the bassboost preset; pass `false` to disable it */
  public async setBassboost(level: "low" | "medium" | "high" | "extreme" | false): Promise<void> {
    this.filters.setBassBoost(level);
    await this.setFilters();
  }

  /** Sets autoplay state and optional custom recommendation fetcher */
  public setAutoplay(enabled: boolean = true, fetcher?: (lastTrack: TTrack) => Promise<TTrack | null>): this {
    this.autoplay = enabled;
    if (fetcher !== undefined) {
      this.autoplayFetcher = fetcher;
    }
    this.scheduleStateSave();
    return this;
  }

  // ─── NodeLink-exclusive player features ──────────────────────────────────

  /** True when this player's node is NodeLink */
  public get isOnNodeLink(): boolean {
    return this._node.isNodeLink;
  }

  private assertNodeLink(feature: string): void {
    if (!this._node.isNodeLink) {
      throw new PlayerError(`${feature} requires a NodeLink node`, this.guildId);
    }
  }

  /**
   * Loads lyrics via NodeLink's built-in /v4/loadlyrics (no plugin needed).
   * @param lang Optional preferred language code (e.g. "en", "ja")
   */
  public async getNodeLinkLyrics(lang?: string, track?: TTrack): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    const encoded = (track ?? this.currentTrack)?.encoded;
    if (!encoded) return null;
    return this._node.rest.loadLyrics(encoded, lang);
  }

  /** Loads YouTube chapter markers via NodeLink's /v4/loadchapters */
  public async getChapters(track?: TTrack): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    const encoded = (track ?? this.currentTrack)?.encoded;
    if (!encoded) return null;
    return this._node.rest.loadChapters(encoded);
  }

  /** Fetches track background/meaning info via NodeLink's /v4/meaning */
  public async getTrackMeaning(track?: TTrack): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    const encoded = (track ?? this.currentTrack)?.encoded;
    if (!encoded) return null;
    return this._node.rest.getMeaning(encoded);
  }

  /**
   * Preloads the next track on the node for gapless playback (NodeLink only).
   * Pass null to clear the preload.
   */
  public async setGaplessNext(track: TTrack | null): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this.assertNodeLink("Gapless preloading");
    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;
    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      nextTrack: track != null ? { encoded: track.encoded } : null,
    });
  }

  /**
   * Configures fade curves (NodeLink only). Sections: trackStart, trackEnd,
   * trackStop, seek, ducking — each `{ duration, curve }` with curve one of
   * linear | exponential | logarithmic | s-curve.
   */
  public async setFading(
    fading: Record<string, { duration: number; curve?: string }>,
  ): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this.assertNodeLink("Fading");
    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;
    await this._node.rest.updatePlayer(sessionId, this.guildId, { fading });
  }

  /** Adds an audio mixer layer (overlay TTS/sound effects — NodeLink only) */
  public async addMixLayer(layer: Record<string, unknown>): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this.assertNodeLink("Audio mixer");
    return this._node.rest.addMixLayer(this._node.rest.sessionId, this.guildId, layer);
  }

  /** Lists active audio mixer layers (NodeLink only) */
  public async getMixLayers(): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this.assertNodeLink("Audio mixer");
    return this._node.rest.getMixLayers(this._node.rest.sessionId, this.guildId);
  }

  /** Updates an audio mixer layer, e.g. `{ volume }` (NodeLink only) */
  public async updateMixLayer(mixId: string, body: Record<string, unknown>): Promise<unknown> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this.assertNodeLink("Audio mixer");
    return this._node.rest.updateMixLayer(this._node.rest.sessionId, this.guildId, mixId, body);
  }

  /** Removes an audio mixer layer (NodeLink only) */
  public async removeMixLayer(mixId: string): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this.assertNodeLink("Audio mixer");
    return this._node.rest.removeMixLayer(this._node.rest.sessionId, this.guildId, mixId);
  }

  /**
   * Creates a voice receiver for this guild via NodeLink's /connection/data
   * WebSocket (NodeLink only). Emits startSpeaking/endSpeaking with captured audio.
   */
  public createVoiceReceiver(): import("../node/NodeLinkVoiceReceiver.ts").NodeLinkVoiceReceiver {
    this.assertNodeLink("Voice receive");
    return this._node.createVoiceReceiver(this.guildId);
  }

  /**
   * Sends Discord OP4 to join the player's voice channel.
   * Requires the `send` option on the YuKumo manager; a no-op otherwise
   * (for setups where the host application dispatches OP4 itself).
   */
  public connect(options?: { selfDeaf?: boolean; selfMute?: boolean }): this {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    if (options?.selfDeaf != null) this._selfDeaf = options.selfDeaf;
    if (options?.selfMute != null) this._selfMute = options.selfMute;
    this.sendVoiceStateToDiscord(this._voiceChannelId);
    return this;
  }

  /** Sends Discord OP4 to leave the voice channel (player itself stays alive) */
  public disconnect(): this {
    this.sendVoiceStateToDiscord(null);
    return this;
  }

  private sendVoiceStateToDiscord(channelId: string | null): void {
    const send = this.kumo.sendGatewayPayload;
    if (send == null) return;
    send(this.guildId, {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: channelId,
        self_mute: this._selfMute,
        self_deaf: this._selfDeaf,
      },
    });
  }

  /** Moves the player to another voice channel (sends OP4 when the manager has a `send` function) */
  public async setVoiceChannel(
    channelId: string,
    options?: { selfDeaf?: boolean; selfMute?: boolean },
  ): Promise<void> {
    if (this._destroyed) throw new PlayerError("Player is destroyed", this.guildId);
    this._voiceChannelId = channelId;
    if (options?.selfDeaf != null) this._selfDeaf = options.selfDeaf;
    if (options?.selfMute != null) this._selfMute = options.selfMute;
    this.sendVoiceStateToDiscord(channelId);
  }

  /**
   * Pushes the current voice credentials to Lavalink immediately.
   * Called when Discord delivers new voice server credentials (initial join,
   * region change, session change) so audio survives without waiting for the next play().
   */
  public async sendVoiceUpdate(): Promise<void> {
    if (this._destroyed || this._voiceStateSent) return;
    const { token, endpoint, sessionId: voiceSessionId } = this._voiceState;
    if (!token || !endpoint || !voiceSessionId) return;

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    try {
      await this._node.rest.updatePlayer(sessionId, this.guildId, {
        voice: { token, endpoint, sessionId: voiceSessionId, channelId: this._voiceChannelId },
      });
      this._voiceStateSent = true;
    } catch (err) {
      // Surface the failure — a rejected voice update means no audio; hiding
      // the node's 4xx/5xx response makes that undiagnosable
      this.events.emit(
        "debug",
        `Voice update rejected for guild ${this.guildId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /**
   * Re-sends full player state (voice credentials, current track, position,
   * volume, pause, filters) to the node. Used after a node reconnects with a
   * fresh Lavalink session (which starts with zero players) and after node
   * failover migration.
   */
  public async resync(): Promise<void> {
    if (this._destroyed) return;

    // The new session has no players — the previous "already sent" state is meaningless
    this._voiceStateSent = false;

    if (!this.hasVoiceCredentials) {
      const globalVoice = this.kumo?.voice?.getVoiceState(this.guildId);
      if (globalVoice != null && globalVoice.token && globalVoice.endpoint && globalVoice.sessionId) {
        this.setVoiceState(globalVoice);
      }
    }
    if (!this.hasVoiceCredentials) {
      this.events.emit(
        "debug",
        `Cannot resync player for guild ${this.guildId}: missing voice credentials`,
      );
      return;
    }

    const sessionId = this._node.rest.sessionId;
    if (sessionId == null) return;

    const { token, endpoint, sessionId: voiceSessionId } = this._voiceState;
    const current = this.queue.currentTrack;
    const filterPayload = this.filters.toPayload();
    const hasFilterKeys = Object.keys(filterPayload).length > 0;

    await this._node.rest.updatePlayer(sessionId, this.guildId, {
      voice: { token: token!, endpoint: endpoint!, sessionId: voiceSessionId!, channelId: this._voiceChannelId },
      ...(current != null
        ? {
            track: { encoded: current.encoded },
            position: this.position,
            paused: this._paused,
          }
        : {}),
      volume: this._volume,
      filters: hasFilterKeys ? filterPayload : undefined,
    });
    this._voiceStateSent = true;
  }

  /** Replaces complete internal voice connection state */
  public setVoiceState(state: InternalVoiceState): void {
    if (
      this._voiceState.token !== state.token ||
      this._voiceState.endpoint !== state.endpoint ||
      this._voiceState.sessionId !== state.sessionId
    ) {
      this._voiceStateSent = false;
    }
    this._voiceState = { ...state };
    if (this.hasVoiceCredentials) {
      this.settleVoiceReadyWaiters();
    }
  }

  /** Updates partial internal voice connection state */
  public updateVoiceState(partial: Partial<InternalVoiceState>): void {
    if (
      (partial.token != null && partial.token !== this._voiceState.token) ||
      (partial.endpoint != null && partial.endpoint !== this._voiceState.endpoint) ||
      (partial.sessionId != null && partial.sessionId !== this._voiceState.sessionId)
    ) {
      this._voiceStateSent = false;
    }
    Object.assign(this._voiceState, partial);
    if (this.hasVoiceCredentials) {
      this.settleVoiceReadyWaiters();
    }
  }

  /**
   * Destroys player, leaves the voice channel, clears queue and filters,
   * removes event listeners, and unregisters itself from the PlayerManager.
   * Safe to call directly (e.g. from auto-disconnect) — manager map and node
   * playerCount stay consistent either way.
   * @param reason A DestroyReasons value (or free-form string) emitted with "playerDestroy".
   * With reason DisconnectAllNodes (client shutdown), a persisted queue is kept
   * on disk so it can be restored after a restart.
   */
  public async destroy(reason: string = DestroyReasons.ManualDestroy): Promise<void> {
    if (this._destroyed) return;
    if (this.emptyVcTimer != null) {
      clearTimeout(this.emptyVcTimer);
      this.emptyVcTimer = null;
    }
    this.cancelQueueEmptyDestroy();
    this.sendVoiceStateToDiscord(null);
    this._destroyed = true;
    this._status = "destroyed";
    this._node.playerCount = Math.max(0, this._node.playerCount - 1);
    this.kumo?.players?.uncache(this.guildId, this as unknown as Player);
    this.settleVoiceReadyWaiters(new PlayerError("Player is destroyed", this.guildId));
    this.removeNodeListeners();
    this.queue.clear();
    this.queue.clearHistory();
    this.filters.clear();
    this.data.clear();
    this.events.removeAllListeners();

    if (this._persistQueue && reason !== DestroyReasons.DisconnectAllNodes) {
      void Promise.resolve(this.kumo.storage.delete(this.queueStorageKey)).catch(() => undefined);
    }
    // Keep the player snapshot on shutdown so a restart can restore it;
    // delete on every normal destroy
    if (this._persistState && reason !== DestroyReasons.DisconnectAllNodes) {
      void Promise.resolve(this.kumo.storage.delete(this.stateStorageKey)).catch(() => undefined);
    }

    const sessionId = this._node.rest.sessionId;
    if (sessionId != null) {
      try {
        await this._node.rest.destroyPlayer(sessionId, this.guildId);
      } catch {
        // ignore destroy errors
      }
    }

    this.kumo?.events?.emit("playerDestroy", this.guildId, reason);
  }

  /** Gets whether player is destroyed */
  public get destroyed(): boolean {
    return this._destroyed;
  }
}
