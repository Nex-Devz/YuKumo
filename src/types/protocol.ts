export const OP_CODES = {
  READY: "ready",
  PLAYER_UPDATE: "playerUpdate",
  STATS: "stats",
  EVENT: "event",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses headers in WS handshake. */
  IDENTIFY: "identify",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses headers in WS handshake. */
  CONFIGURE_RESUMING: "configureResuming",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  VOICE_UPDATE: "voiceUpdate",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  PLAY: "play",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  STOP: "stop",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  PAUSE: "pause",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  SEEK: "seek",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  VOLUME: "volume",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST PATCH /v4/sessions/{id}/players/{guildId}. */
  FILTERS: "filters",
  /** @deprecated Legacy Lavalink v3 client opcode. Lavalink v4 uses REST DELETE /v4/sessions/{id}/players/{guildId}. */
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
  /** Lavalink v4 load metric */
  lavalinkLoad?: number;
  /** NodeLink's name for the same metric */
  nodelinkLoad?: number;
}

export interface FrameStats {
  sent: number;
  nulled: number;
  deficit: number;
  /** NodeLink only */
  expected?: number;
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

// ─── NodeLink-only filter settings ────────────────────────────────────────

export interface EchoSettings {
  /** Delay in milliseconds (0–2000) */
  delay?: number;
  /** Feedback 0–1 */
  feedback?: number;
  /** Wet/dry mix 0–1 */
  mix?: number;
}

export interface ChorusSettings {
  rate?: number;
  /** 0–1 */
  depth?: number;
  /** Delay in ms (max 45) */
  delay?: number;
  /** 0–1 */
  mix?: number;
  /** 0–0.95 */
  feedback?: number;
}

export interface CompressorSettings {
  /** Threshold in dB */
  threshold?: number;
  /** Ratio >= 1 */
  ratio?: number;
  /** Attack in seconds */
  attack?: number;
  /** Release in seconds */
  release?: number;
  /** Makeup gain in dB */
  makeupGain?: number;
}

export interface PhaserSettings {
  /** Number of stages (2–12) */
  stages?: number;
  rate?: number;
  /** 0–1 */
  depth?: number;
  /** 0–0.9 */
  feedback?: number;
  /** 0–1 */
  mix?: number;
  minFrequency?: number;
  maxFrequency?: number;
}

export interface HighPassSettings {
  /** >1 activates the filter; 0 disables it */
  smoothing?: number;
}

export interface FlangerSettings {
  rate?: number;
  /** 0–1 */
  depth?: number;
  /** 0–0.95 */
  feedback?: number;
}

export interface ReverbSettings {
  /** 0–1 */
  mix?: number;
  /** 0–1 */
  roomSize?: number;
  /** 0–1 */
  damping?: number;
  /** 0–1 */
  width?: number;
  /** Optional custom comb delays (ms) */
  delays?: number[];
  /** Optional custom comb gains (>= 0.95) */
  gains?: number[];
}

export interface SpatialSettings {
  /** 0–1 */
  depth?: number;
  rate?: number;
}

export interface PhonographSettings {
  frequency?: number;
  /** 0–1 */
  depth?: number;
  /** 0–1 */
  crackle?: number;
  /** 0–1 */
  flutter?: number;
  /** 0–1 */
  room?: number;
  /** 0–1 */
  micAgc?: number;
  /** 0–1 */
  drive?: number;
}

export interface TesseractSettings {
  /** > 0.001 activates the filter */
  rotationHz?: number;
}

// ─── NodeLink fading / crossfade settings ─────────────────────────────────

export type FadeType = "volume" | "tape" | "scratch" | "both";
export type FadeCurve = "linear" | "exponential" | "logarithmic" | "s-curve";

export interface FadeSection {
  /** Duration in milliseconds */
  duration: number;
  curve?: FadeCurve;
  type?: FadeType;
}

export interface FadingSettings {
  enabled?: boolean;
  trackStart?: FadeSection;
  trackEnd?: FadeSection;
  trackStop?: FadeSection;
  seek?: FadeSection;
  pause?: FadeSection;
  resume?: FadeSection;
  /** Nested under `fading` on the NodeLink wire format */
  ducking?: {
    enabled?: boolean;
    /** Duration in ms (default 500) */
    duration?: number;
    /** 0–1 (default 0.3) */
    targetVolume?: number;
    curve?: FadeCurve;
  };
}

export interface CrossfadeSettings {
  enabled: boolean;
  /** Duration in ms (0–30000, default 5000) */
  duration?: number;
  /** "linear" | "sine" | "sinusoidal" (default sinusoidal) */
  curve?: "linear" | "sine" | "sinusoidal";
  /** "stream" | "preload" (default preload) */
  mode?: "stream" | "preload";
  /** 20–30000 (default 250) */
  minBufferMs?: number;
  /** 0–30000 (default 0) */
  bufferMs?: number;
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
  /** NodeLink-only filters */
  echo?: EchoSettings;
  chorus?: ChorusSettings;
  compressor?: CompressorSettings;
  phaser?: PhaserSettings;
  highpass?: HighPassSettings;
  flanger?: FlangerSettings;
  reverb?: ReverbSettings;
  spatial?: SpatialSettings;
  phonograph?: PhonographSettings;
  tesseract?: TesseractSettings;
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

// ─── NodeLink-exclusive protocol types ────────────────────────────────────

export interface SponsorBlockSegment {
  uuid?: string;
  category?: string;
  start: number;
  end: number;
}

export interface SponsorBlockState {
  enabled: boolean;
  categories: string[];
  actionTypes: string[];
  segments: SponsorBlockSegment[];
  lastSkippedUuid?: string | null;
  skipMarginMs?: number;
}

export interface NodeLinkGroup {
  id: string;
  guildIds: string[];
  createdAt: number;
}

export interface NodeLinkGroupUpdateBody {
  players?: { add?: string[]; remove?: string[] };
  track?: {
    encoded?: string | null;
    identifier?: string;
    userData?: Record<string, unknown>;
    audioTrackId?: string;
    language?: string;
  };
  position?: number;
  endTime?: number | null;
  volume?: number;
  paused?: boolean;
  filters?: FiltersObject;
  fading?: FadingSettings;
  loudnessNormalizer?: boolean;
  ducking?: boolean;
}

export interface LoadStreamOptions {
  /** Encoded track to stream */
  encodedTrack: string;
  /** Volume 0–1000 (default 100) */
  volume?: number;
  /** Position in milliseconds (default 0) */
  position?: number;
  filters?: FiltersObject;
}

export interface TrackStreamResult {
  url: string;
  protocol: string;
  format: string;
  newTrack?: TrackData;
  exception?: ExceptionData;
  additionalData?: Record<string, unknown>;
}

export interface YouTubeConfig {
  refreshToken: string | null;
  visitorData: string | null;
  isConfigured: boolean;
  isValid?: boolean | null;
}

export interface WorkerInfo {
  id: number;
  [key: string]: unknown;
}

/** NodeLink encodeTrack payload — mirrors the wire `info` object */
export interface EncodeTrackPayload {
  title: string;
  author: string;
  length: number;
  identifier: string;
  isStream: boolean;
  uri?: string | null;
  artworkUrl?: string | null;
  isrc?: string | null;
  sourceName: string;
  position: number;
  details?: (string | null)[];
}
