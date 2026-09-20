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

  public handleRaw(packet: unknown): void {
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
