import type { TrackData, TrackInfo } from "../types/protocol.ts";
import { encodeTrackInfo, decodeTrackInfo } from "./TrackEncoder.ts";
import { formatDuration } from "../utils/UIHelpers.ts";

export class Track {
  public readonly encoded: string;
  public readonly info: TrackInfo;
  public readonly pluginInfo: Record<string, unknown>;
  public requester: unknown;
  public metadata: Record<string, unknown>;

  public constructor(data: TrackData, requester?: unknown) {
    this.encoded = data.encoded;
    this.info = { ...data.info };
    this.pluginInfo = { ...data.pluginInfo };
    this.requester = requester ?? data.userData?.requester;
    this.metadata = data.userData ?? {};
  }

  public get identifier(): string {
    return this.info.identifier;
  }

  public get title(): string {
    return this.info.title;
  }

  public get author(): string {
    return this.info.author;
  }

  public get duration(): number {
    return this.info.length;
  }

  public get durationFormatted(): string {
    return formatDuration(this.info.length);
  }

  public get uri(): string | null {
    return this.info.uri;
  }

  public get thumbnail(): string | null {
    return this.info.artworkUrl;
  }

  public get isStream(): boolean {
    return this.info.isStream;
  }

  public get isSeekable(): boolean {
    return this.info.isSeekable;
  }

  public get sourceName(): string {
    return this.info.sourceName;
  }

  /** Alias for duration — matches Lavalink's raw info.length property name */
  public get length(): number {
    return this.info.length;
  }

  /** Alias for sourceName — shorter naming convention */
  public get source(): string {
    return this.info.sourceName;
  }

  /** Alias for thumbnail — direct artworkUrl access */
  public get artworkUrl(): string | null {
    return this.info.artworkUrl;
  }

  /** Track ISRC code if available */
  public get isrc(): string | null {
    return this.info.isrc;
  }

  public toJSON(): TrackData {
    return {
      encoded: this.encoded,
      info: { ...this.info },
      pluginInfo: { ...this.pluginInfo },
      userData: {
        ...this.metadata,
        // requester is stored outside metadata; merge it back so the
        // Track.from(track.toJSON()) round-trip (and JSON persistence) keeps it
        ...(this.requester !== undefined ? { requester: this.requester } : {}),
      },
    };
  }

  public static from(data: TrackData, requester?: unknown): Track {
    return new Track(data, requester);
  }

  /** Encodes track info into Lavalink v4 base64 format locally (no server needed) */
  public static encode(info: TrackInfo): string {
    return encodeTrackInfo(info);
  }

  /** Decodes a Lavalink v4 base64 track into its raw info fields */
  public static decode(encoded: string): TrackInfo {
    return decodeTrackInfo(encoded);
  }

  /**
   * Builds a usable track entirely on the client — encodes the info locally
   * so it can be played without resolving against a node. Mirrors Wavelink's
   * `PartialTrack.create()`.
   */
  public static build(
    info: Partial<TrackInfo> & Pick<TrackInfo, "title" | "author">,
    requester?: unknown,
  ): Track {
    const resolved: TrackInfo = {
      identifier: info.identifier ?? info.title,
      title: info.title,
      author: info.author,
      length: info.length ?? 0,
      uri: info.uri ?? null,
      sourceName: info.sourceName ?? "local",
      position: info.position ?? 0,
      isStream: info.isStream ?? false,
      isSeekable: info.isSeekable ?? true,
      artworkUrl: info.artworkUrl ?? null,
      isrc: info.isrc ?? null,
    };
    return new Track({ encoded: encodeTrackInfo(resolved), info: resolved, pluginInfo: {} }, requester);
  }
}

export class UnresolvedTrack {
  public readonly identifier: string;
  public readonly source?: string;
  public requester: unknown;
  public metadata: Record<string, unknown>;

  public constructor(identifier: string, options?: { source?: string; requester?: unknown }) {
    this.identifier = identifier;
    this.source = options?.source;
    this.requester = options?.requester;
    this.metadata = {};
  }

  public toQuery(): string {
    if (this.identifier.includes(":") || /^https?:\/\//i.test(this.identifier)) {
      return this.identifier;
    }
    if (this.source != null) {
      const prefix = this.source.endsWith("search") ? this.source : `${this.source}search`;
      return `${prefix}:${this.identifier}`;
    }
    return `ytsearch:${this.identifier}`;
  }

  public resolve(track: Track): Track {
    const resolved = Track.from(track.toJSON(), this.requester);
    resolved.metadata = { ...this.metadata, ...resolved.metadata };
    return resolved;
  }
}

export class Playlist {
  public readonly name: string;
  public readonly tracks: Track[];
  public readonly selectedTrack: number;
  public readonly duration: number;
  public readonly pluginInfo: Record<string, unknown>;

  public constructor(options: {
    name: string;
    tracks: Track[];
    selectedTrack?: number;
    pluginInfo?: Record<string, unknown>;
  }) {
    this.name = options.name;
    this.tracks = options.tracks;
    this.selectedTrack = options.selectedTrack ?? -1;
    this.pluginInfo = options.pluginInfo ?? {};
    this.duration = this.tracks.reduce((sum, t) => sum + t.duration, 0);
  }

  public get size(): number {
    return this.tracks.length;
  }

  public get selected(): Track | null {
    if (this.selectedTrack < 0 || this.selectedTrack >= this.tracks.length) {
      return null;
    }
    return this.tracks[this.selectedTrack] as Track;
  }
}
