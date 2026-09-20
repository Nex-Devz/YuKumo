import type { YuKumo } from "../Kumo.ts";
import { isVoicePacket } from "./RawGatewayAdapter.ts";

export interface MinimalDiscordJSClient {
  on(event: "raw", listener: (packet: { t: string; d: Record<string, unknown> }) => void): unknown;
  off?(event: "raw", listener: (packet: { t: string; d: Record<string, unknown> }) => void): unknown;
  ws: {
    shards: {
      get(id: number): { send(data: unknown): void } | undefined;
    };
  };
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

  private readonly rawListener = (packet: { t: string; d: Record<string, unknown> }): void => {
    if (!isVoicePacket(packet)) return;

    if (packet.t === "VOICE_STATE_UPDATE") {
      const d = packet.d;
      const botId = this.client.user?.id ?? this.kumo.userId;
      if (botId != null && botId.length > 0 && String(d.user_id) !== botId) return;

      this.kumo.handleVoiceStateUpdate({
        guildId: String(d.guild_id ?? ""),
        sessionId: String(d.session_id ?? ""),
        channelId: d.channel_id != null ? String(d.channel_id) : null,
        userId: String(d.user_id ?? ""),
      });
    } else if (packet.t === "VOICE_SERVER_UPDATE") {
      const d = packet.d;
      this.kumo.handleVoiceServerUpdate(String(d.guild_id ?? ""), {
        token: String(d.token ?? ""),
        endpoint: d.endpoint != null ? String(d.endpoint) : null,
      });
    } else if (packet.t === "CHANNEL_DELETE") {
      const d = packet.d;
      if (d.guild_id != null && d.id != null) {
        void this.kumo.handleChannelDelete(String(d.guild_id), String(d.id));
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
    if (!guild) return;

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
