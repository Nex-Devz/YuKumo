/**
 * Integer state codes for Node connection state — migration compat for consumers
 * coming from wrappers that use numeric enums (Erela.js, Poru, Magmastream).
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
 * used by legacy wrappers (Erela.js, Poru, Magmastream).
 */
export const LoadTypeMap: Record<string, string> = {
  track: "TRACK_LOADED",
  playlist: "PLAYLIST_LOADED",
  search: "SEARCH_RESULT",
  empty: "NO_MATCHES",
  error: "LOAD_FAILED",
};
