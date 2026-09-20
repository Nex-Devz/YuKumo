import type { YuKumo } from "../Kumo.ts";
import { isVoicePacket, type RawGatewayPacket } from "./RawGatewayAdapter.ts";

/**
 * Adapter for the Davey Discord client. Routes raw gateway packets into the
 * manager; use {@link buildVoiceStatePayload} to craft OP4 payloads for sending.
 */
export class DaveyAdapter {
  private readonly kumo: YuKumo;

  public constructor(kumo: YuKumo) {
    this.kumo = kumo;
  }

  /**
   * Surfaces rejected manager pipelines (voice teardown, plugin hooks) as debug
   * events instead of letting them become unhandled rejections.
   */
  private readonly reportManagerError = (err: unknown): void => {
    this.kumo.events.emit(
      "debug",
      `Davey adapter pipeline error: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  public handleRawPacket(packet: RawGatewayPacket): void {
    if (!isVoicePacket(packet)) return;

    if (packet.t === "VOICE_STATE_UPDATE") {
      const d = packet.d;
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
  }

  public buildVoiceStatePayload(
    guildId: string,
    channelId: string | null,
    selfDeaf = true,
    selfMute = false,
  ): {
    op: 4;
    d: {
      guild_id: string;
      channel_id: string | null;
      self_deaf: boolean;
      self_mute: boolean;
    };
  } {
    return {
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_deaf: selfDeaf,
        self_mute: selfMute,
      },
    };
  }
}
