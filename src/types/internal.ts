import type { LoadResult, TrackData } from "./protocol.ts";

export interface NodeConfig {
  host: string;
  port: number;
  password: string;
  name?: string;
  secure?: boolean;
  region?: string;
  resumeTimeout?: number;
  resumeKey?: string;
  maxRetries?: number;
  retryDelay?: number;
  retryDelayMax?: number;
  /** Milliseconds to wait for the WebSocket handshake before failing connect() (default 15000) */
  connectTimeout?: number;
}

export interface NodeStats {
  players: number;
  playingPlayers: number;
  uptime: number;
  memory: {
    free: number;
    used: number;
    allocated: number;
    reservable: number;
  };
  cpu: {
    cores: number;
    systemLoad: number;
    lavalinkLoad: number;
  };
  frameStats: {
    sent: number;
    nulled: number;
    deficit: number;
  } | null;
}

export type NodeState = "disconnected" | "connecting" | "connected" | "destroyed";

/** Discord gateway OP4 voice state payload, dispatched through the user-provided `send` function */
export interface VoiceGatewayPayload {
  op: 4;
  d: {
    guild_id: string;
    channel_id: string | null;
    self_mute: boolean;
    self_deaf: boolean;
  };
}

export interface ManagerOptions {
  nodes: NodeConfig[];
  userId?: string;
  /** Custom logger for internal diagnostics; defaults to a no-op logger */
  logger?: import("../utils/Logger.ts").Logger;
  /** Minimum level passed through to the logger (default "warn"; "silent" disables) */
  logLevel?: import("../utils/Logger.ts").LogLevel;
  /**
   * Sends a raw payload to the Discord gateway for the shard handling the guild.
   * Required for player.connect()/disconnect()/setVoiceChannel() to actually join
   * or leave voice channels. Example (discord.js):
   * `send: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload)`
   */
  send?: (guildId: string, payload: VoiceGatewayPayload) => void;
  /**
   * What to do when the bot is disconnected from a voice channel
   * (VOICE_STATE_UPDATE with channel_id null).
   * - destroyPlayer (default true): destroy the player.
   * - autoReconnect: re-send OP4 to rejoin the last channel and resume the
   *   current track at its saved position. Takes precedence over destroyPlayer.
   */
  onDisconnect?: {
    destroyPlayer?: boolean;
    autoReconnect?: boolean;
  };
  defaultSearchSource?: string;
  defaultNodeSelector?: {
    pick: (
      nodes: Array<{ id: string; state: NodeState; penalties: { total: number }; playerCount: number }>,
      guildId: string,
    ) => { id: string } | null;
  };
  storageAdapter?: StorageAdapter;
  plugins?: Array<{
    name: string;
    version: string;
    init?(manager: unknown): void | Promise<void>;
    start?(): void | Promise<void>;
    destroy?(): void | Promise<void>;
  }>;
  /** Voice connection timeout in milliseconds (default 15000) */
  voiceConnectionTimeout?: number;
  /** Number of voice connection retry attempts before throwing (default 0) */
  voiceConnectionRetries?: number;
}

export type RepeatMode = "none" | "track" | "queue";

export interface InternalVoiceState {
  sessionId: string | null;
  channelId: string | null;
  endpoint: string | null;
  token: string | null;
}

export interface VoiceServerUpdate {
  token: string;
  /** Null while Discord allocates a new voice region — hold until a real endpoint arrives */
  endpoint: string | null;
}

export interface VoiceStateUpdate {
  sessionId: string;
  channelId: string | null;
  guildId: string;
  userId: string;
}

export interface SearchOptions {
  query: string;
  source?: string;
  nodeName?: string;
  requester?: unknown;
}

export interface SearchResult {
  loadType: LoadResult["loadType"];
  /** Uppercase loadType alias for migration compat (e.g. "TRACK_LOADED", "SEARCH_RESULT") */
  type?: string;
  tracks: TrackData[];
  playlistInfo?: {
    name: string;
    selectedTrack: number;
  };
  exception?: {
    message: string | null;
    severity: string;
    cause: string;
  } | null;
  pluginInfo?: Record<string, unknown>;
}

export interface StorageAdapter {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  /** Optional teardown hook; called by YuKumo.destroy() so backends can release connections */
  disconnect?(): Promise<void>;
}

export type EventMap = {
  nodeReady: (nodeId: string) => void;
  nodeDisconnected: (nodeId: string, code: number, reason: string) => void;
  nodeReconnected: (nodeId: string) => void;
  nodeError: (nodeId: string, error: Error) => void;
  playerCreate: (guildId: string) => void;
  playerDestroy: (guildId: string) => void;
  playerMove: (guildId: string, fromNode: string, toNode: string) => void;
  /** Emitted when the bot disconnects from a voice channel */
  playerDisconnect: (guildId: string, reason: string) => void;
  /** Emitted when queue empties and playback stops — alias for queueEnd */
  playerEmpty: (guildId: string) => void;
  /** Emitted when the bot is moved between voice channels */
  playerMoved: (guildId: string, oldChannel: string, newChannel: string) => void;
  trackStart: (guildId: string, track: TrackData) => void;
  trackEnd: (guildId: string, track: TrackData, reason: string) => void;
  trackStuck: (guildId: string, track: TrackData, thresholdMs: number) => void;
  trackException: (guildId: string, track: TrackData, exception: unknown) => void;
  queueEnd: (guildId: string) => void;
  playerUpdate: (
    guildId: string,
    state: { time: number; position: number; connected: boolean; ping: number },
  ) => void;
  stats: (nodeId: string, stats: NodeStats) => void;
  debug: (message: string) => void;
  /** Discord voice WebSocket closed on the Lavalink side (codes 4xxx are Discord voice close codes) */
  socketClosed: (guildId: string, code: number, reason: string, byRemote: boolean) => void;
  voiceReady: (guildId: string) => void;
  voiceDisconnected: (guildId: string) => void;
  voiceReconnecting: (guildId: string) => void;
  /** Emitted when a voice connection times out */
  voiceConnectionTimeout: (guildId: string) => void;
  autoplayTrackAdded: (guildId: string, track: TrackData) => void;
  playerAutoPaused: (guildId: string) => void;
  playerAutoDisconnected: (guildId: string) => void;
};

export type EventName = keyof EventMap;

export type EventCallback<E extends EventName> = EventMap[E];
