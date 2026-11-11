import type { TrackData } from "../types/protocol.ts";
import type { SearchResult } from "../types/internal.ts";

export interface Plugin {
  readonly name: string;
  readonly version: string;
  init?(manager?: unknown): void | Promise<void>;
  start?(): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface LifecycleHookPipeline {
  beforeSearch?: (query: string, source?: string) => Promise<{ query: string; source?: string } | null>;
  afterSearch?: (result: SearchResult) => Promise<SearchResult | null>;
  beforeConnect?: (
    guildId: string,
    channelId: string,
  ) => Promise<{ guildId: string; channelId: string } | null>;
  afterConnect?: (guildId: string, channelId: string) => Promise<void>;
  beforePlay?: (guildId: string, track: TrackData) => Promise<TrackData | null>;
  afterPlay?: (guildId: string, track: TrackData) => Promise<void>;
  beforeDestroy?: (guildId: string) => Promise<boolean>;
  afterDestroy?: (guildId: string) => Promise<void>;
  onNodeSelect?: (guildId: string, availableNodes: string[]) => Promise<string | null>;
}
