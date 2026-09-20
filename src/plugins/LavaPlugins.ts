import type { Plugin } from "./Plugin.ts";

/**
 * A {@link Plugin} that declares a server-side Lavalink plugin the node already
 * runs (LavaSrc, SponsorBlock, FloweryTTS, …). These plugins are configured in
 * the node's `application.yml`, not over the wire, so the client helper carries
 * no runtime behavior — it exists so `manager.plugins.get(name)` can confirm the
 * plugin is expected and so the intended options are introspectable via
 * `options`. Registering one never mutates the server.
 */
export interface ServerPluginMarker<TOptions> extends Plugin {
  /** True — distinguishes a declarative server-plugin marker from an active client plugin */
  readonly isServerPlugin: true;
  /** The options you intend the node to be configured with (for your own introspection) */
  readonly options: TOptions;
}

export interface LavaSrcOptions {
  spotify?: {
    clientId?: string;
    clientSecret?: string;
    countryCode?: string;
    playlistPageLimit?: number;
    albumPageLimit?: number;
  };
  appleMusic?: {
    countryCode?: string;
    mediaAPIToken?: string;
  };
  deezer?: {
    masterKey?: string;
  };
  yandexMusic?: {
    accessToken?: string;
  };
}

export type SponsorBlockCategory =
  "sponsor" | "selfpromo" | "interaction" | "intro" | "outro" | "preview" | "music_offtopic";

export interface SponsorBlockOptions {
  categories?: SponsorBlockCategory[];
}

export interface FloweryTTSOptions {
  voice?: string;
  speed?: number;
  translate?: boolean;
  silence?: number;
}

/**
 * Declares the LavaSrc server plugin (Spotify, Apple Music, Deezer, Yandex
 * Music sources). LavaSrc is configured in the node's `application.yml`; this
 * marker records the options you expect and lets `manager.plugins.get("lavasrc")`
 * confirm the plugin is in use. It does not push config to the node.
 */
export function createLavaSrcPlugin(options: LavaSrcOptions = {}): ServerPluginMarker<LavaSrcOptions> {
  return { name: "lavasrc", version: "4.0.0", isServerPlugin: true, options };
}

/**
 * Declares the SponsorBlock server plugin (skips sponsor segments in YouTube
 * tracks). Server-side config lives in `application.yml`; per-player skip
 * categories are set at runtime via `RestClient.setSponsorBlockCategories()` /
 * the NodeLink SponsorBlock endpoints. This marker carries no runtime behavior.
 */
export function createSponsorBlockPlugin(
  options: SponsorBlockOptions = {},
): ServerPluginMarker<SponsorBlockOptions> {
  return { name: "sponsorblock", version: "4.0.0", isServerPlugin: true, options };
}

/**
 * Declares the FloweryTTS server plugin (Text-to-Speech). Configured in the
 * node's `application.yml`; usage is via `ftts://` search prefixes once the
 * plugin is installed. This marker carries no runtime behavior.
 */
export function createFloweryTTSPlugin(
  options: FloweryTTSOptions = {},
): ServerPluginMarker<FloweryTTSOptions> {
  return { name: "flowerytts", version: "4.0.0", isServerPlugin: true, options };
}
