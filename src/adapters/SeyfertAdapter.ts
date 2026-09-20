import { YuKumo } from "../Kumo.ts";
import { isVoicePacket } from "./RawGatewayAdapter.ts";

/** The minimal Seyfert client surface Yukumo drives. */
export interface MinimalSeyfertClient {
  events?: { rawWS?: (listener: (packet: unknown) => void) => void };
  on?(event: string, listener: (packet: unknown) => void): unknown;
  off?(event: string, listener: (packet: unknown) => void): unknown;
  gateway?: { send(shardId: number, data: unknown): void };
}

/**
 * Adapter for the Seyfert Discord framework.
 */
export class SeyfertAdapter {
  private readonly client: MinimalSeyfertClient;
  private readonly kumo: YuKumo;

  private readonly packetListener = (packet: unknown): void => this.handlePacket(packet);
  private subscribedEvent: string | null = null;

  constructor(client: MinimalSeyfertClient, kumo: YuKumo) {
    this.client = client;
    this.kumo = kumo;
    this.setupListeners();
    this.kumo.registerAdapter(this);
  }

  private setupListeners(): void {
    if (typeof this.client.events?.rawWS === "function") {
      this.client.events.rawWS(this.packetListener);
    } else if (typeof this.client.on === "function") {
      // Subscribe to exactly one event name — clients emitting both "rawWS" and
      // "raw" would otherwise process every voice packet twice
      this.client.on("rawWS", this.packetListener);
      this.subscribedEvent = "rawWS";
    }
  }

  /** Detaches the gateway listener; called automatically by YuKumo.destroy() */
  public destroy(): void {
    if (this.subscribedEvent != null && typeof this.client.off === "function") {
      this.client.off(this.subscribedEvent, this.packetListener);
    }
  }

  public handlePacket(packet: unknown): void {
    if (!isVoicePacket(packet)) return;
    const { t, d } = packet;

    if (t === "VOICE_STATE_UPDATE") {
      this.kumo.handleVoiceStateUpdate({
        guildId: String(d.guild_id ?? ""),
        sessionId: String(d.session_id ?? ""),
        channelId: d.channel_id != null ? String(d.channel_id) : null,
        userId: String(d.user_id ?? ""),
      });
    } else if (t === "VOICE_SERVER_UPDATE") {
      this.kumo.handleVoiceServerUpdate(String(d.guild_id ?? ""), {
        token: String(d.token ?? ""),
        endpoint: d.endpoint != null ? String(d.endpoint) : null,
      });
    } else if (t === "CHANNEL_DELETE") {
      if (d.guild_id != null && d.id != null) {
        void this.kumo.handleChannelDelete(String(d.guild_id), String(d.id));
      }
    }
  }

  public sendVoiceStateUpdate(
    guildId: string,
    channelId: string | null,
    selfDeaf = true,
    selfMute = false,
  ): void {
    if (typeof this.client.gateway?.send === "function") {
      this.client.gateway.send(0, {
        op: 4,
        d: { guild_id: guildId, channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute },
      });
    }
  }
}
