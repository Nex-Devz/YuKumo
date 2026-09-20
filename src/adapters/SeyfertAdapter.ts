import { YuKumo } from "../Kumo.ts";
import { isVoicePacket } from "./RawGatewayAdapter.ts";

/** The minimal Seyfert client surface Yukumo drives. */
export interface MinimalSeyfertClient {
  events?: {
    rawWS?: (listener: (packet: unknown) => void) => (() => void) | void;
  };
  on?(event: string, listener: (packet: unknown) => void): unknown;
  off?(event: string, listener: (packet: unknown) => void): unknown;
  gateway?: {
    send(shardId: number, data: unknown): void;
    /** Total shard count (when known) — used to route OP4 voice updates to the guild's shard. */
    shardsCount?: number;
  };
}

/**
 * Adapter for the Seyfert Discord framework.
 */
export class SeyfertAdapter {
  private readonly client: MinimalSeyfertClient;
  private readonly kumo: YuKumo;

  private readonly packetListener = (packet: unknown): void => this.handlePacket(packet);
  private subscribedEvent: string | null = null;
  private unsubscribeRawWs: (() => void) | null = null;

  /**
   * Surfaces rejected manager pipelines (voice teardown, plugin hooks) as debug
   * events instead of letting them become unhandled rejections.
   */
  private readonly reportManagerError = (err: unknown): void => {
    this.kumo.events.emit(
      "debug",
      `Seyfert adapter pipeline error: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  constructor(client: MinimalSeyfertClient, kumo: YuKumo) {
    this.client = client;
    this.kumo = kumo;
    this.setupListeners();
    this.kumo.registerAdapter(this);
  }

  private setupListeners(): void {
    if (typeof this.client.events?.rawWS === "function") {
      this.unsubscribeRawWs = this.client.events.rawWS(this.packetListener) ?? null;
      if (this.unsubscribeRawWs == null) {
        this.kumo.events.emit(
          "debug",
          "Seyfert: events.rawWS exposes no detach handle; the raw listener cannot be removed by destroy()",
        );
      }
    } else if (typeof this.client.on === "function") {
      // Subscribe to exactly one event name — clients emitting both "rawWS" and
      // "raw" would otherwise process every voice packet twice
      this.client.on("rawWS", this.packetListener);
      this.subscribedEvent = "rawWS";
    } else {
      this.kumo.events.emit(
        "debug",
        "Seyfert: no raw gateway subscription path found (events.rawWS or client.on('rawWS')); voice events will not be processed",
      );
    }
  }

  /** Detaches the gateway listener; called automatically by YuKumo.destroy() */
  public destroy(): void {
    if (this.unsubscribeRawWs != null) {
      this.unsubscribeRawWs();
      this.unsubscribeRawWs = null;
    }
    if (this.subscribedEvent != null && typeof this.client.off === "function") {
      this.client.off(this.subscribedEvent, this.packetListener);
      this.subscribedEvent = null;
    }
  }

  public handlePacket(packet: unknown): void {
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
  }

  public sendVoiceStateUpdate(
    guildId: string,
    channelId: string | null,
    selfDeaf = true,
    selfMute = false,
  ): void {
    const gateway = this.client.gateway;
    if (typeof gateway?.send !== "function") return;

    // Route to the guild's shard (standard Discord: shard = (guild_id >> 22) % shard_count)
    // instead of always sending to shard 0, which silently drops OP4 for other shards.
    const shardCount = gateway.shardsCount;
    const shardId =
      shardCount != null && shardCount > 0 && /^\d{17,20}$/.test(guildId)
        ? Number((BigInt(guildId) >> 22n) % BigInt(shardCount))
        : 0;

    gateway.send(shardId, {
      op: 4,
      d: { guild_id: guildId, channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute },
    });
  }
}
