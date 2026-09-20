import type { LavalinkInfo } from "../types/protocol.ts";

/** The resolved server family behind a node. `auto` only appears in config, never after ready. */
export type NodeType = "lavalink" | "nodelink";

/**
 * A high-level feature a node may or may not support. Used by `node.supports()`
 * and capability-aware node selection so a NodeLink-only request never lands on
 * a plain Lavalink node.
 */
export type NodeFeature =
  | "lyrics"
  | "chapters"
  | "meaning"
  | "voiceReceive"
  | "extraFilters"
  | "stream"
  | "mixer"
  | "sponsorblock"
  | "lyricsSubscribe"
  | "groups"
  | "youtubeConfig"
  | "routeplanner"
  | "sessionResume";

/**
 * A node's resolved capabilities. `filters` is the exact set of filter names the
 * server reported as enabled (`/v4/info.filters`); `sourceManagers` is the list
 * of enabled sources. `features` is the derived high-level feature set queried by
 * `node.supports()`.
 */
export interface NodeCapabilities {
  readonly type: NodeType;
  readonly version: string | null;
  readonly features: ReadonlySet<NodeFeature>;
  readonly filters: ReadonlySet<string>;
  readonly sourceManagers: ReadonlySet<string>;
}

/** Standard Lavalink v4 filters — always available on both server families. */
export const STANDARD_FILTERS: ReadonlySet<string> = new Set([
  "volume",
  "equalizer",
  "karaoke",
  "timescale",
  "tremolo",
  "vibrato",
  "rotation",
  "distortion",
  "channelMix",
  "lowPass",
]);

/** NodeLink-exclusive DSP filters (verified in NodeLink `src/playback/filters/*`). */
export const NODELINK_EXTRA_FILTERS: ReadonlySet<string> = new Set([
  "echo",
  "chorus",
  "compressor",
  "phaser",
  "highpass",
  "flanger",
  "reverb",
  "spatial",
  "phonograph",
  "tesseract",
]);

/** Features every NodeLink node exposes over its REST/WS surface. */
const NODELINK_FEATURES: readonly NodeFeature[] = [
  "lyrics",
  "chapters",
  "meaning",
  "voiceReceive",
  "extraFilters",
  "stream",
  "mixer",
  "sponsorblock",
  "lyricsSubscribe",
  "groups",
  "youtubeConfig",
  "routeplanner",
  "sessionResume",
];

/**
 * Features a plain Lavalink node exposes on its own. `lyrics`/`sponsorblock`
 * depend on server plugins we can't reliably detect per-feature, so they are
 * left out here and remain best-effort via the existing plugin markers.
 */
const LAVALINK_FEATURES: readonly NodeFeature[] = ["routeplanner", "sessionResume"];

/**
 * Builds a node's capabilities from its resolved type and (optional) `/v4/info`
 * payload. When `info` is missing (info fetch failed) we fall back to the
 * type's default feature set with an empty filter/source list.
 */
export function buildCapabilities(type: NodeType, info: LavalinkInfo | null): NodeCapabilities {
  const version = extractVersion(info);
  const sourceManagers = new Set(info?.sourceManagers ?? []);

  if (type === "nodelink") {
    // NodeLink reports the exact enabled filter set; fall back to the full
    // extra-filter set when info didn't list any (older builds / info failure).
    const reportedFilters = info?.filters != null && info.filters.length > 0 ? info.filters : null;
    const filters = new Set<string>([...STANDARD_FILTERS, ...(reportedFilters ?? NODELINK_EXTRA_FILTERS)]);
    const features = new Set<NodeFeature>(NODELINK_FEATURES);
    // `extraFilters` is only truly supported if at least one extra filter is enabled
    if (![...NODELINK_EXTRA_FILTERS].some((f) => filters.has(f))) {
      features.delete("extraFilters");
    }
    return { type, version, features, filters, sourceManagers };
  }

  // Lavalink: standard filters plus whatever info listed; no NodeLink extras.
  const filters = new Set<string>([...STANDARD_FILTERS, ...(info?.filters ?? [])]);
  return {
    type,
    version,
    features: new Set<NodeFeature>(LAVALINK_FEATURES),
    filters,
    sourceManagers,
  };
}

/** Extracts a human-readable version string from either server family's info shape. */
function extractVersion(info: LavalinkInfo | null): string | null {
  if (info == null) return null;
  const v = info.version as unknown;
  if (typeof v === "string") return v;
  if (v != null && typeof v === "object" && "semver" in v) {
    const semver = (v as { semver?: unknown }).semver;
    if (typeof semver === "string") return semver;
  }
  return null;
}
