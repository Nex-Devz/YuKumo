import { YuKumo } from "../Kumo.ts";
import { isVoicePacket } from "./RawGatewayAdapter.ts";

/**
 * Adapter for Discordeno framework.
 */
export class DiscordenoAdapter {
  private readonly kumo: YuKumo;

  constructor(kumo: YuKumo) {
    this.kumo = kumo;
  }

  /**
   * Surfaces rejected manager pipelines (voice teardown, plugin hooks) as debug
   * events instead of letting them become unhandled rejections.
   */
  private readonly reportManagerError = (err: unknown): void => {
    this.kumo.events.emit(
      "debug",
      `Discordeno adapter pipeline error: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  public handleRaw(packet: unknown): void {
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

  public buildVoiceStatePayload(
    guildId: string,
    channelId: string | null,
    selfDeaf = true,
    selfMute = false,
  ): {
    op: 4;
    d: { guild_id: string; channel_id: string | null; self_deaf: boolean; self_mute: boolean };
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
