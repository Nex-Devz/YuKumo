import { RestError, LoadError } from "../errors/index.ts";
import { retry, type RetryOptions } from "../utils/index.ts";
import type {
  LoadResult,
  PlayerData,
  SessionData,
  TrackData,
  LavalinkInfo,
  RoutePlannerStatus,
  FiltersObject,
  LavaSearchType,
  LavaSearchResult,
} from "../types/protocol.ts";

export interface RestCacheOptions {
  /**
   * Whether REST caching for track search/decode requests is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Time-to-live for cached responses in milliseconds.
   * @default 60000 (1 minute)
   */
  ttlMs?: number;
  /**
   * Maximum number of entries allowed in cache before oldest entry eviction.
   * @default 500
   */
  maxEntries?: number;
}

export interface RestClientOptions {
  /** Lavalink node host address */
  host: string;
  /** Lavalink node REST port */
  port: number;
  /** Authorization password */
  password: string;
  /** Whether to use HTTPS */
  secure?: boolean;
  /** Current session ID */
  sessionId?: string;
  /** Network timeout in milliseconds */
  timeout?: number;
  /** Network retry options */
  retryOptions?: RetryOptions;
  /** REST response caching options */
  cacheOptions?: RestCacheOptions;
  /** Custom HTTP headers merged into every request (cannot override Authorization) */
  httpHeaders?: Record<string, string>;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

function buildBaseUrl(host: string, port: number, secure?: boolean): string {
  return `${(secure ?? false) ? "https" : "http"}://${host}:${port}/v4`;
}

/**
 * Default retry policy: network failures, timeouts, rate limits, and server
 * errors are transient; other 4xx responses (404, 400, 401…) never succeed
 * on retry, so retrying them only burns time and requests.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof RestError) {
    return error.statusCode === 0 || error.statusCode === 429 || error.statusCode >= 500;
  }
  return true;
}

/**
 * Lavalink v4 REST API Client. Handles track loading, decoding, session management,
 * player updates, filters, and routeplanner endpoints with built-in caching and retry logic.
 */
export class RestClient {
  private readonly baseUrl: string;
  private readonly password: string;
  private readonly timeout: number;
  private readonly retryOptions?: RetryOptions;
  private readonly cacheEnabled: boolean;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly responseCache = new Map<string, CacheEntry<unknown>>();
  private readonly httpHeaders?: Record<string, string>;
  private _sessionId: string | null;

  public constructor(options: RestClientOptions) {
    this.baseUrl = buildBaseUrl(options.host, options.port, options.secure);
    this.password = options.password;
    this.timeout = options.timeout ?? 15000;
    this.retryOptions = options.retryOptions;
    this.httpHeaders = options.httpHeaders;
    this._sessionId = options.sessionId ?? null;

    this.cacheEnabled = options.cacheOptions?.enabled ?? true;
    this.cacheTtlMs = options.cacheOptions?.ttlMs ?? 60_000;
    this.cacheMaxEntries = options.cacheOptions?.maxEntries ?? 500;
  }

  /** Gets the active Lavalink session ID */
  public get sessionId(): string | null {
    return this._sessionId;
  }

  /** Sets the active Lavalink session ID */
  public set sessionId(id: string | null) {
    this._sessionId = id;
  }

  /** Clears the internal REST response cache */
  public clearCache(): void {
    this.responseCache.clear();
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "YuKumo/0.0.1",
      ...this.httpHeaders,
      // Authorization last — custom headers must not override node auth
      Authorization: this.password,
    };
  }

  private getCached<T>(key: string): T | null {
    if (!this.cacheEnabled) return null;
    const entry = this.responseCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.responseCache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCached<T>(key: string, data: T): void {
    if (!this.cacheEnabled) return;
    if (this.responseCache.size >= this.cacheMaxEntries) {
      const firstKey = this.responseCache.keys().next().value;
      if (firstKey) this.responseCache.delete(firstKey);
    }
    this.responseCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const doFetch = async (): Promise<T> => {
      // AbortSignal actually cancels the request on timeout — a raced timer
      // would leave the socket open and let retries stack concurrent copies
      const options: RequestInit = {
        method,
        headers: this.buildHeaders(),
        body: body != null ? JSON.stringify(body) : undefined,
        keepalive: true,
        signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(this.timeout) : undefined,
      };

      let response: Response;
      try {
        response = await fetch(url.toString(), options);
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new RestError(
            `Request to ${method} ${path} timed out after ${this.timeout}ms`,
            0,
            path,
            "REST_TIMEOUT",
          );
        }
        throw error;
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers?.get?.("Retry-After");
        let waitMs = 1000;
        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSeconds)) {
            waitMs = parsedSeconds * 1000;
          }
        }
        // Consume the body so the keep-alive connection can be reused,
        // then throw immediately — retry() honors retryAfter as the delay
        await response.body?.cancel?.().catch?.(() => undefined);
        const rateLimitError = new RestError(`Rate limited (429)`, 429, path) as RestError & {
          retryAfter: number;
        };
        rateLimitError.retryAfter = waitMs;
        throw rateLimitError;
      }

      if (!response.ok) {
        let errorBody: Record<string, unknown> | undefined;
        try {
          errorBody = (await response.json()) as Record<string, unknown>;
        } catch {
          // ignore parse errors
        }

        const message = (errorBody?.message as string) ?? response.statusText;
        throw new RestError(message, response.status, path);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    };

    return retry(doFetch, {
      ...this.retryOptions,
      shouldRetry: this.retryOptions?.shouldRetry ?? isRetryableError,
    });
  }

  /**
   * Updates session parameters on the Lavalink node.
   * @param sessionId The target session ID
   * @param options Session update parameters (resuming, timeout)
   */
  public async updateSession(
    sessionId: string,
    options: { resuming?: boolean; timeout?: number },
  ): Promise<SessionData> {
    return this.request<SessionData>("PATCH", `/sessions/${sessionId}`, options);
  }

  /**
   * Resolves an explicit session ID or falls back to the one received from the
   * node's ready op — so callers that cached a pre-reconnect ID can pass null
   * and always target the live session.
   */
  private resolveSessionId(sessionId: string | null | undefined, path: string): string {
    const sid = sessionId != null && sessionId !== "" ? sessionId : this._sessionId;
    if (sid == null || sid === "") {
      throw new RestError("No active Lavalink session (node not ready)", 0, path, "NO_SESSION");
    }
    return sid;
  }

  /**
   * Fetches all active players for a session.
   * @param sessionId The target session ID (null uses the current session)
   */
  public async getPlayers(sessionId: string | null = null): Promise<PlayerData[]> {
    const sid = this.resolveSessionId(sessionId, "/sessions/-/players");
    return this.request<PlayerData[]>("GET", `/sessions/${sid}/players`);
  }

  /**
   * Fetches player state for a specific guild.
   * @param sessionId The target session ID (null uses the current session)
   * @param guildId The target guild ID
   */
  public async getPlayer(sessionId: string | null, guildId: string): Promise<PlayerData | null> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}`);
    try {
      return await this.request<PlayerData>("GET", `/sessions/${sid}/players/${guildId}`);
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Updates or creates player state for a guild on the Lavalink node.
   * @param sessionId The target session ID
   * @param guildId The target guild ID
   * @param options Track, volume, pause state, voice parameters, or filter updates
   * @param noReplace If true, ignores track parameter if player is already playing a track
   */
  public async updatePlayer(
    sessionId: string | null,
    guildId: string,
    options: {
      track?: { encoded?: string | null; identifier?: string; userData?: Record<string, unknown> } | null;
      position?: number;
      endTime?: number | null;
      volume?: number;
      paused?: boolean;
      filters?: FiltersObject;
      voice?: { token: string; endpoint: string; sessionId: string; channelId?: string | null };
    },
    noReplace?: boolean,
  ): Promise<PlayerData> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}`);
    const params: Record<string, string> = {};
    if (noReplace === true) {
      params.noReplace = "true";
    }
    return this.request<PlayerData>(
      "PATCH",
      `/sessions/${sid}/players/${guildId}`,
      options,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  /**
   * Destroys the player for a guild.
   * @param sessionId The target session ID
   * @param guildId The target guild ID
   */
  public async destroyPlayer(sessionId: string | null, guildId: string): Promise<void> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}`);
    return this.request<void>("DELETE", `/sessions/${sid}/players/${guildId}`);
  }

  /**
   * Loads tracks, playlists, or search results for a given identifier.
   * Cached automatically when caching is enabled.
   * @param identifier Track identifier or search query (e.g. `ytsearch:faded`)
   */
  public async loadTracks(identifier: string): Promise<LoadResult> {
    const cacheKey = `load:${identifier}`;
    const cached = this.getCached<LoadResult>(cacheKey);
    if (cached) return cached;

    const result = await this.request<LoadResult>("GET", "/loadtracks", undefined, { identifier });
    if (result.loadType !== "error") {
      this.setCached(cacheKey, result);
    }
    return result;
  }

  /**
   * Decodes a single base64 encoded track string.
   * @param encodedTrack Base64 encoded track string
   */
  public async decodeTrack(encodedTrack: string): Promise<TrackData> {
    const cacheKey = `decode:${encodedTrack}`;
    const cached = this.getCached<TrackData>(cacheKey);
    if (cached) return cached;

    const result = await this.request<TrackData>("GET", "/decodetrack", undefined, { encodedTrack });
    this.setCached(cacheKey, result);
    return result;
  }

  /**
   * Decodes multiple base64 encoded track strings in a single request.
   * @param encodedTracks Array of base64 encoded track strings
   */
  public async decodeTracks(encodedTracks: string[]): Promise<TrackData[]> {
    return this.request<TrackData[]>("POST", "/decodetracks", encodedTracks);
  }

  /**
   * Retrieves Lavalink node metadata and plugin details.
   */
  public async getInfo(): Promise<LavalinkInfo> {
    return this.request<LavalinkInfo>("GET", "/info");
  }

  /**
   * Retrieves Lavalink server statistics.
   */
  public async getStats(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/stats");
  }

  /**
   * Retrieves Lavalink server version string.
   */
  public async getVersion(): Promise<string> {
    return this.request<string>("GET", "/version");
  }

  /**
   * Retrieves IP RoutePlanner status.
   */
  public async getRoutePlannerStatus(): Promise<RoutePlannerStatus> {
    return this.request<RoutePlannerStatus>("GET", "/routeplanner/status");
  }

  /**
   * Unmarks a failed IP address in the RoutePlanner.
   * @param address IP address string
   */
  public async unmarkFailedAddress(address: string): Promise<void> {
    return this.request<void>("POST", "/routeplanner/free/address", {
      address,
    });
  }

  /**
   * Unmarks all failed IP addresses in the RoutePlanner.
   */
  public async unmarkAllFailedAddresses(): Promise<void> {
    return this.request<void>("POST", "/routeplanner/free/all");
  }

  /**
   * Resolves a single track data object from an identifier string or throws a LoadError.
   * @param identifier Track identifier or search query
   */
  public async resolveTrack(identifier: string): Promise<TrackData> {
    const result = await this.loadTracks(identifier);

    switch (result.loadType) {
      case "track": {
        return result.data;
      }
      case "search": {
        if (result.data.length === 0) {
          throw new LoadError(`No results found for identifier: ${identifier}`);
        }
        return result.data[0] as TrackData;
      }
      case "playlist": {
        if (result.data.tracks.length === 0) {
          throw new LoadError(`Playlist is empty for identifier: ${identifier}`);
        }
        return result.data.tracks[0] as TrackData;
      }
      case "empty": {
        throw new LoadError(`No matches found for identifier: ${identifier}`);
      }
      case "error": {
        throw new LoadError(result.data.message ?? "Failed to load track");
      }
      default: {
        throw new LoadError(`Unexpected load result type: ${(result as LoadResult).loadType}`);
      }
    }
  }

  /**
   * Performs a multi-category LavaSearch query across tracks, albums, artists, playlists, or texts.
   * @param query Search query string
   * @param types Optional array of search result types to include
   */
  public async lavaSearch(query: string, types?: LavaSearchType[]): Promise<LavaSearchResult> {
    const params: Record<string, string> = { query };
    if (types && types.length > 0) {
      params.types = types.join(",");
    }
    return this.request<LavaSearchResult>("GET", "/lavasearch", undefined, params);
  }

  /**
   * Gets the SponsorBlock categories configured for a guild's player.
   * Requires the SponsorBlock plugin on the node.
   */
  public async getSponsorBlockCategories(
    sessionId: string | null,
    guildId: string,
  ): Promise<string[]> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}/sponsorblock/categories`);
    return this.request<string[]>("GET", `/sessions/${sid}/players/${guildId}/sponsorblock/categories`);
  }

  /**
   * Sets the SponsorBlock categories to auto-skip for a guild's player.
   * Requires the SponsorBlock plugin on the node.
   */
  public async setSponsorBlockCategories(
    sessionId: string | null,
    guildId: string,
    categories: string[],
  ): Promise<void> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}/sponsorblock/categories`);
    return this.request<void>(
      "PUT",
      `/sessions/${sid}/players/${guildId}/sponsorblock/categories`,
      categories,
    );
  }

  /**
   * Clears the SponsorBlock categories for a guild's player.
   * Requires the SponsorBlock plugin on the node.
   */
  public async deleteSponsorBlockCategories(sessionId: string | null, guildId: string): Promise<void> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}/sponsorblock/categories`);
    return this.request<void>("DELETE", `/sessions/${sid}/players/${guildId}/sponsorblock/categories`);
  }

  /**
   * Fetches lyrics of the track currently playing on a guild's player.
   * Requires the LavaLyrics plugin on the node.
   */
  public async getCurrentLyrics(
    sessionId: string | null,
    guildId: string,
    skipTrackSource: boolean = false,
  ): Promise<unknown> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}/track/lyrics`);
    return this.request<unknown>("GET", `/sessions/${sid}/players/${guildId}/track/lyrics`, undefined, {
      skipTrackSource: String(skipTrackSource),
    });
  }

  /**
   * Subscribes to live lyrics events (lyricsFound/lyricsNotFound/lyricsLine)
   * for a guild's player. Requires the LavaLyrics plugin on the node.
   */
  public async subscribeLyrics(
    sessionId: string | null,
    guildId: string,
    skipTrackSource: boolean = false,
  ): Promise<void> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}/lyrics/subscribe`);
    return this.request<void>("POST", `/sessions/${sid}/players/${guildId}/lyrics/subscribe`, undefined, {
      skipTrackSource: String(skipTrackSource),
    });
  }

  /**
   * Unsubscribes from live lyrics events for a guild's player.
   * Requires the LavaLyrics plugin on the node.
   */
  public async unsubscribeLyrics(sessionId: string | null, guildId: string): Promise<void> {
    const sid = this.resolveSessionId(sessionId, `/sessions/-/players/${guildId}/lyrics/subscribe`);
    return this.request<void>("DELETE", `/sessions/${sid}/players/${guildId}/lyrics/subscribe`);
  }

  /**
   * Fetches lyrics for a specific track.
   * Note: This requires the Lavalink Lyrics plugin to be installed on the node.
   * @param encodedTrack The encoded track base64 string
   */
  public async getLyrics(encodedTrack: string): Promise<any> {
    const key = `lyrics:${encodedTrack}`;
    const cached = this.getCached<any>(key);
    if (cached) return cached;

    const params: Record<string, string> = { track: encodedTrack };
    // The lyrics plugin typically binds to /v4/lyrics or /v4/loadlyrics
    const res = await this.request<any>("GET", "/lyrics", undefined, params);
    this.setCached(key, res);
    return res;
  }
}
