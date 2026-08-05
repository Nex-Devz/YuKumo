export const OP_CODES = {
  READY: "ready",
  PLAYER_UPDATE: "playerUpdate",
  STATS: "stats",
  EVENT: "event",
  IDENTIFY: "identify",
  CONFIGURE_RESUMING: "configureResuming",
  VOICE_UPDATE: "voiceUpdate",
  PLAY: "play",
  STOP: "stop",
  PAUSE: "pause",
  SEEK: "seek",
  VOLUME: "volume",
  FILTERS: "filters",
  DESTROY: "destroy",
} as const;

export type OpCode = (typeof OP_CODES)[keyof typeof OP_CODES];

export const EVENT_TYPES = {
  TRACK_START: "TrackStartEvent",
  TRACK_END: "TrackEndEvent",
  TRACK_EXCEPTION: "TrackExceptionEvent",
  TRACK_STUCK: "TrackStuckEvent",
  WEBSOCKET_CLOSED: "WebSocketClosedEvent",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const TRACK_END_REASONS = {
  FINISHED: "finished",
  LOAD_FAILED: "loadFailed",
  STOPPED: "stopped",
  REPLACED: "replaced",
  CLEANUP: "cleanup",
} as const;

export type TrackEndReason = (typeof TRACK_END_REASONS)[keyof typeof TRACK_END_REASONS];

export const SEVERITY = {
  COMMON: "common",
  SUSPICIOUS: "suspicious",
  FAULT: "fault",
} as const;

export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

export const LOAD_RESULT_TYPE = {
  TRACK: "track",
  PLAYLIST: "playlist",
  SEARCH: "search",
  EMPTY: "empty",
  ERROR: "error",
} as const;

export type LoadResultType = (typeof LOAD_RESULT_TYPE)[keyof typeof LOAD_RESULT_TYPE];

export interface IdentifyPayload {
  op: typeof OP_CODES.IDENTIFY;
  guildId: string;
}

export interface ConfigureResumingPayload {
  op: typeof OP_CODES.CONFIGURE_RESUMING;
  key: string;
  timeout: number;
}

export interface VoiceUpdatePayload {
  op: typeof OP_CODES.VOICE_UPDATE;
  guildId: string;
  sessionId: string;
  event: {
    token: string;
    endpoint: string;
  };
}

export interface PlayPayload {
  op: typeof OP_CODES.PLAY;
  guildId: string;
  encodedTrack?: string | null;
  identifier?: string;
  position?: number;
  endTime?: number | null;
  volume?: number;
  paused?: boolean;
  noReplace?: boolean;
}

export interface StopPayload {
  op: typeof OP_CODES.STOP;
  guildId: string;
}

export interface PausePayload {
  op: typeof OP_CODES.PAUSE;
  guildId: string;
  pause: boolean;
}

export interface SeekPayload {
  op: typeof OP_CODES.SEEK;
  guildId: string;
  position: number;
}

export interface VolumePayload {
  op: typeof OP_CODES.VOLUME;
  guildId: string;
  volume: number;
}

export interface FiltersPayload {
  op: typeof OP_CODES.FILTERS;
  guildId: string;
  filters: FiltersObject;
}

export interface DestroyPayload {
  op: typeof OP_CODES.DESTROY;
  guildId: string;
}

export type OutgoingPayload =
  | IdentifyPayload
  | ConfigureResumingPayload
  | VoiceUpdatePayload
  | PlayPayload
  | StopPayload
  | PausePayload
  | SeekPayload
  | VolumePayload
  | FiltersPayload
  | DestroyPayload;

export interface ReadyOp {
  op: typeof OP_CODES.READY;
  resumed: boolean;
  sessionId: string;
}

export interface PlayerState {
  time: number;
  position: number;
  connected: boolean;
  ping: number;
}

export interface PlayerUpdateOp {
  op: typeof OP_CODES.PLAYER_UPDATE;
  guildId: string;
  state: PlayerState;
}

export interface MemoryStats {
  free: number;
  used: number;
  allocated: number;
  reservable: number;
}

export interface CpuStats {
  cores: number;
  systemLoad: number;
  lavalinkLoad: number;
}

export interface FrameStats {
  sent: number;
  nulled: number;
  deficit: number;
}

export interface StatsOp {
  op: typeof OP_CODES.STATS;
  players: number;
  playingPlayers: number;
  uptime: number;
  memory: MemoryStats;
  cpu: CpuStats;
  frameStats: FrameStats | null;
}

export interface TrackInfo {
  identifier: string;
  isSeekable: boolean;
  author: string;
  length: number;
  isStream: boolean;
  position: number;
  title: string;
  uri: string | null;
  artworkUrl: string | null;
  isrc: string | null;
  sourceName: string;
}

export interface TrackData {
  encoded: string;
  info: TrackInfo;
  pluginInfo: Record<string, unknown>;
  userData?: Record<string, unknown>;
}

export interface TrackStartEvent {
  op: typeof OP_CODES.EVENT;
  type: typeof EVENT_TYPES.TRACK_START;
  guildId: string;
  track: TrackData;
}

export interface TrackEndEvent {
  op: typeof OP_CODES.EVENT;
  type: typeof EVENT_TYPES.TRACK_END;
  guildId: string;
  track: TrackData;
  reason: TrackEndReason;
}

export interface ExceptionData {
  message: string | null;
  severity: Severity;
  cause: string;
  causeStackTrace: string;
}

export interface TrackExceptionEvent {
  op: typeof OP_CODES.EVENT;
  type: typeof EVENT_TYPES.TRACK_EXCEPTION;
  guildId: string;
  track: TrackData;
  exception: ExceptionData;
}

export interface TrackStuckEvent {
  op: typeof OP_CODES.EVENT;
  type: typeof EVENT_TYPES.TRACK_STUCK;
  guildId: string;
  track: TrackData;
  thresholdMs: number;
}

export interface WebSocketClosedEvent {
  op: typeof OP_CODES.EVENT;
  type: typeof EVENT_TYPES.WEBSOCKET_CLOSED;
  guildId: string;
  code: number;
  reason: string;
  byRemote: boolean;
}

export type IncomingEvent =
  TrackStartEvent | TrackEndEvent | TrackExceptionEvent | TrackStuckEvent | WebSocketClosedEvent;

export type IncomingOp = ReadyOp | PlayerUpdateOp | StatsOp | IncomingEvent;

export interface VoiceState {
  token: string;
  endpoint: string;
  sessionId: string;
  channelId?: string | null;
}

export interface EqualizerBand {
  band: number;
  gain: number;
}

export interface KaraokeSettings {
  level?: number;
  monoLevel?: number;
  filterBand?: number;
  filterWidth?: number;
}

export interface TimescaleSettings {
  speed?: number;
  pitch?: number;
  rate?: number;
}

export interface TremoloSettings {
  frequency?: number;
  depth?: number;
}

export interface VibratoSettings {
  frequency?: number;
  depth?: number;
}

export interface RotationSettings {
  rotationHz?: number;
}

export interface DistortionSettings {
  sinOffset?: number;
  sinScale?: number;
  cosOffset?: number;
  cosScale?: number;
  tanOffset?: number;
  tanScale?: number;
  offset?: number;
  scale?: number;
}

export interface ChannelMixSettings {
  leftToLeft?: number;
  leftToRight?: number;
  rightToLeft?: number;
  rightToRight?: number;
}

export interface LowPassSettings {
  smoothing?: number;
}

export interface FiltersObject {
  volume?: number;
  equalizer?: EqualizerBand[];
  karaoke?: KaraokeSettings;
  timescale?: TimescaleSettings;
  tremolo?: TremoloSettings;
  vibrato?: VibratoSettings;
  rotation?: RotationSettings;
  distortion?: DistortionSettings;
  channelMix?: ChannelMixSettings;
  lowPass?: LowPassSettings;
  pluginFilters?: Record<string, Record<string, unknown>>;
}

export interface PlaylistInfoData {
  name: string;
  selectedTrack: number;
}

export interface TrackLoadResult {
  loadType: typeof LOAD_RESULT_TYPE.TRACK;
  data: TrackData;
}

export interface PlaylistLoadResult {
  loadType: typeof LOAD_RESULT_TYPE.PLAYLIST;
  data: {
    info: PlaylistInfoData;
    pluginInfo: Record<string, unknown>;
    tracks: TrackData[];
  };
}

export interface SearchLoadResult {
  loadType: typeof LOAD_RESULT_TYPE.SEARCH;
  data: TrackData[];
}

export interface EmptyLoadResult {
  loadType: typeof LOAD_RESULT_TYPE.EMPTY;
  data: null;
}

export interface ErrorLoadResult {
  loadType: typeof LOAD_RESULT_TYPE.ERROR;
  data: ExceptionData;
}

export type LoadResult =
  TrackLoadResult | PlaylistLoadResult | SearchLoadResult | EmptyLoadResult | ErrorLoadResult;

export interface PlayerData {
  guildId: string;
  track?: TrackData | null;
  volume: number;
  paused: boolean;
  state: PlayerState;
  voice: VoiceState;
  filters: FiltersObject;
}

export interface SessionData {
  resuming: boolean;
  timeout: number;
}

export interface VersionInfo {
  semver: string;
  major: number;
  minor: number;
  patch: number;
  preRelease: string | null;
  build: string | null;
}

export interface GitInfo {
  branch: string;
  commit: string;
  commitTime: number;
}

export interface PluginInfo {
  name: string;
  version: string;
}

export interface LavalinkInfo {
  version: VersionInfo;
  buildTime: number;
  git: GitInfo;
  jvm: string;
  lavaplayer: string;
  sourceManagers: string[];
  filters: string[];
  plugins: PluginInfo[];
  /** Present (true) when the node is NodeLink rather than Lavalink */
  isNodelink?: boolean;
  /** NodeLink reports the Node.js runtime version here instead of jvm/lavaplayer */
  node?: string;
}

export interface RoutePlannerStatus {
  class?: string;
  details?: RoutePlannerDetails;
}

export interface RoutePlannerDetails {
  ipBlock: IpBlock;
  failingAddresses: FailingAddress[];
  rotateIndex?: string;
  ipIndex?: string;
  currentAddress?: string;
  currentAddressIndex?: string;
  blockIndex?: string;
}

export interface IpBlock {
  type: "Inet4Address" | "Inet6Address";
  size: string;
}

export interface FailingAddress {
  failingAddress: string;
  failingTimestamp: number;
  failingTime: string;
}

export type LavaSearchType = "track" | "album" | "artist" | "playlist" | "text";

export interface LavaSearchResult {
  tracks?: TrackData[];
  albums?: Array<{
    info: PlaylistInfoData;
    pluginInfo: Record<string, unknown>;
    tracks: TrackData[];
  }>;
  artists?: Array<{
    info: PlaylistInfoData;
    pluginInfo: Record<string, unknown>;
    tracks: TrackData[];
  }>;
  playlists?: Array<{
    info: PlaylistInfoData;
    pluginInfo: Record<string, unknown>;
    tracks: TrackData[];
  }>;
  texts?: Array<{
    text: string;
    pluginInfo: Record<string, unknown>;
  }>;
  pluginInfo?: Record<string, unknown>;
}
