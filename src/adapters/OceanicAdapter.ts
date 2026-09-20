import { YuKumo } from "../Kumo.ts";
import { isVoicePacket } from "./RawGatewayAdapter.ts";

/** The minimal Oceanic.js client surface Yukumo drives. */
export interface MinimalOceanicClient {
  on?(event: "packet", listener: (packet: unknown) => void): unknown;
  off?(event: "packet", listener: (packet: unknown) => void): unknown;
  guilds?: {
    get?(id: string): { shard?: { send(op: number, data: unknown): void } } | undefined;
  };
}

/**
 * Adapter for the Oceanic.js Discord library.
 */
export class OceanicAdapter {
  private readonly client: MinimalOceanicClient;
  private readonly kumo: YuKumo;

  /**
   * Surfaces rejected manager pipelines (voice teardown, plugin hooks) as debug
   * events instead of letting them become unhandled rejections.
   */
  private readonly reportManagerError = (err: unknown): void => {
    this.kumo.events.emit(
      "debug",
      `Oceanic adapter pipeline error: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  private readonly packetListener = (packet: unknown): void => {
    if (!isVoicePacket(packet)) return;
    const { t, d } = packet;

    if (t === "VOICE_STATE_UPDATE") {
      void this.kumo
        .handleVoiceStateUpdate({
          guildId: String(d.guild_id ?? ""),
          sessionId: String(d.session_id ?? ""),
          channelId: d.channel_id != null ? String(d.channel_id) : null,
          userId: String(d.user_id ?? ""),
        })
        .catch(this.reportManagerError);
    } else if (t === "VOICE_SERVER_UPDATE") {
      void this.kumo
        .handleVoiceServerUpdate(String(d.guild_id ?? ""), {
          token: String(d.token ?? ""),
          endpoint: d.endpoint != null ? String(d.endpoint) : null,
        })
        .catch(this.reportManagerError);
    } else if (t === "CHANNEL_DELETE") {
      if (d.guild_id != null && d.id != null) {
        void this.kumo.handleChannelDelete(String(d.guild_id), String(d.id)).catch(this.reportManagerError);
      }
    }
  };

  constructor(client: MinimalOceanicClient, kumo: YuKumo) {
    this.client = client;
    this.kumo = kumo;
    if (typeof this.client.on === "function") {
      this.client.on("packet", this.packetListener);
    }
    this.kumo.registerAdapter(this);
  }

  /** Detaches the packet listener; called automatically by YuKumo.destroy() */
  public destroy(): void {
    if (typeof this.client.off === "function") {
      this.client.off("packet", this.packetListener);
    }
  }

  public sendVoiceStateUpdate(
    guildId: string,
    channelId: string | null,
    selfDeaf = true,
    selfMute = false,
  ): void {
    const guild = this.client.guilds?.get?.(guildId);
    if (guild != null && typeof guild.shard?.send === "function") {
      guild.shard.send(4, {
        guild_id: guildId,
        channel_id: channelId,
        self_deaf: selfDeaf,
        self_mute: selfMute,
      });
    }
  }
}
