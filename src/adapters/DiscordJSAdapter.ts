import type { YuKumo } from "../Kumo.ts";
import { isVoicePacket } from "./RawGatewayAdapter.ts";

export interface MinimalDiscordJSClient {
  on(event: "raw", listener: (packet: { t: string; d: Record<string, unknown> }) => void): unknown;
  off?(event: "raw", listener: (packet: { t: string; d: Record<string, unknown> }) => void): unknown;
  guilds: {
    cache: {
      get(id: string): { shardId: number; shard: { send(data: unknown): void } } | undefined;
    };
  };
  user?: { id: string } | null;
}

/**
 * First-class adapter connecting Yukumo with discord.js v14 clients.
 */
export class DiscordJSAdapter {
  private readonly client: MinimalDiscordJSClient;
  private readonly kumo: YuKumo;

  /**
   * Surfaces rejected manager pipelines (voice teardown, plugin hooks) as debug
   * events instead of letting them become unhandled rejections.
   */
  private readonly reportManagerError = (err: unknown): void => {
    this.kumo.events.emit(
      "debug",
      `DiscordJS adapter pipeline error: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  private readonly rawListener = (packet: { t: string; d: Record<string, unknown> }): void => {
    if (!isVoicePacket(packet)) return;

    if (packet.t === "VOICE_STATE_UPDATE") {
      const d = packet.d;
      // Identity (bot vs member) is enforced once, in Kumo.handleVoiceStateUpdate,
      // so every update is forwarded here for a single source of truth.
      void this.kumo
        .handleVoiceStateUpdate({
          guildId: String(d.guild_id ?? ""),
          sessionId: String(d.session_id ?? ""),
          channelId: d.channel_id != null ? String(d.channel_id) : null,
          userId: String(d.user_id ?? ""),
        })
        .catch(this.reportManagerError);
    } else if (packet.t === "VOICE_SERVER_UPDATE") {
      const d = packet.d;
      void this.kumo
        .handleVoiceServerUpdate(String(d.guild_id ?? ""), {
          token: String(d.token ?? ""),
          endpoint: d.endpoint != null ? String(d.endpoint) : null,
        })
        .catch(this.reportManagerError);
    } else if (packet.t === "CHANNEL_DELETE") {
      const d = packet.d;
      if (d.guild_id != null && d.id != null) {
        void this.kumo.handleChannelDelete(String(d.guild_id), String(d.id)).catch(this.reportManagerError);
      }
    }
  };

  public constructor(client: MinimalDiscordJSClient, kumo: YuKumo) {
    this.client = client;
    this.kumo = kumo;

    this.client.on("raw", this.rawListener);
    this.kumo.registerAdapter(this);
  }

  /** Detaches the raw gateway listener; called automatically by YuKumo.destroy() */
  public destroy(): void {
    this.client.off?.("raw", this.rawListener);
  }

  /**
   * Sends voice state update payload to Discord via discord.js shard connection
   */
  public sendVoiceStateUpdate(
    guildId: string,
    channelId: string | null,
    selfDeaf: boolean = true,
    selfMute: boolean = false,
  ): void {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.kumo.events.emit(
        "debug",
        `DiscordJS: guild ${guildId} is not cached; cannot send voice state update`,
      );
      return;
    }

    guild.shard.send({
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_deaf: selfDeaf,
        self_mute: selfMute,
      },
    });
  }
}
