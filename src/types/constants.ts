/**
 * Integer state codes for Node connection state — provided for consumers
 * migrating from wrappers that represent node state as a numeric enum.
 */
export const NodeStateCode = {
  DISCONNECTED: 0,
  CONNECTING: 1,
  CONNECTED: 2,
  DESTROYED: 3,
} as const;

export type NodeStateCodeValue = (typeof NodeStateCode)[keyof typeof NodeStateCode];

/**
 * Loop / repeat mode constants.
 */
export const LoopMode = {
  NONE: "none",
  TRACK: "track",
  QUEUE: "queue",
} as const;

export type LoopModeValue = (typeof LoopMode)[keyof typeof LoopMode];

/**
 * Maps Lavalink v4 lowercase loadType values to the uppercase format
 * used by older Lavalink wrappers, for consumers migrating from them.
 */
export const LoadTypeMap: Record<string, string> = {
  track: "TRACK_LOADED",
  playlist: "PLAYLIST_LOADED",
  search: "SEARCH_RESULT",
  empty: "NO_MATCHES",
  error: "LOAD_FAILED",
};

/**
 * Standardized reasons passed to Player.destroy() and emitted with the
 * "playerDestroy" event.
 */
export const DestroyReasons = {
  QueueEmpty: "QueueEmpty",
  NodeDestroy: "NodeDestroy",
  NodeDeleted: "NodeDeleted",
  LavalinkNoVoice: "LavalinkNoVoice",
  NodeReconnectFail: "NodeReconnectFail",
  Disconnected: "Disconnected",
  PlayerReconnectFail: "PlayerReconnectFail",
  ChannelDeleted: "ChannelDeleted",
  DisconnectAllNodes: "DisconnectAllNodes",
  TrackErrorMaxTracksErroredPerTime: "TrackErrorMaxTracksErroredPerTime",
  TrackStuckMaxTracksErroredPerTime: "TrackStuckMaxTracksErroredPerTime",
  EmptyVoiceChannel: "EmptyVoiceChannel",
  ManualDestroy: "ManualDestroy",
} as const;

export type DestroyReason = (typeof DestroyReasons)[keyof typeof DestroyReasons] | string;
