import type { YuKumo } from "../Kumo.ts";

export interface RawGatewayPacket {
  t: string;
  d: Record<string, unknown>;
  op?: number;
}

/**
 * A gateway payload as it may arrive from a third-party library before we've
 * confirmed its shape — `t`/`d` are optional until {@link isVoicePacket} narrows it.
 */
export interface LooseGatewayPacket {
  t?: unknown;
  d?: unknown;
}

/**
 * Narrows an unknown value to a gateway packet carrying a string `t` and an
 * object `d`. Shared by every framework adapter so the voice-packet guard is
 * identical (and type-safe) everywhere.
 */
export function isVoicePacket(
  packet: unknown,
): packet is { t: string; d: Record<string, unknown> } {
  if (packet == null || typeof packet !== "object") return false;
  const { t, d } = packet as LooseGatewayPacket;
  return typeof t === "string" && t.length > 0 && d != null && typeof d === "object";
}

/**
 * Universal adapter for processing raw Discord Gateway WebSocket payloads directly.
 */
export class RawGatewayAdapter {
  private readonly kumo: YuKumo;

  public constructor(kumo: YuKumo) {
    this.kumo = kumo;
  }

  /**
   * Processes a raw Gateway WebSocket event packet.
   * Call this from your raw gateway listener.
   */
  public handleRawPacket(packet: RawGatewayPacket): void {
    if (!isVoicePacket(packet)) return;

    if (packet.t === "VOICE_STATE_UPDATE") {
      const d = packet.d;
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
  }

  /**
   * Formats a standard Discord Opcode 4 (Voice State Update) payload object for sending to Discord WS.
   */
  public buildVoiceStatePayload(
    guildId: string,
    channelId: string | null,
    selfDeaf: boolean = true,
    selfMute: boolean = false,
  ): { op: 4; d: { guild_id: string; channel_id: string | null; self_deaf: boolean; self_mute: boolean } } {
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
