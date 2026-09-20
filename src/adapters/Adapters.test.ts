import { describe, it, expect, vi } from "vitest";
import { DiscordJSAdapter } from "./DiscordJSAdapter.ts";
import { ErisAdapter } from "./ErisAdapter.ts";
import { RawGatewayAdapter } from "./RawGatewayAdapter.ts";
import { DaveyAdapter } from "./DaveyAdapter.ts";
import { DiscordenoAdapter } from "./DiscordenoAdapter.ts";
import { SeyfertAdapter } from "./SeyfertAdapter.ts";
import { YuKumo } from "../Kumo.ts";

describe("Discord Adapters", () => {
  it("DiscordJSAdapter should handle voice events and send voice state updates", () => {
    const kumo = new YuKumo({ nodes: [] });
    const voiceStateSpy = vi.spyOn(kumo, "handleVoiceStateUpdate");
    const voiceServerSpy = vi.spyOn(kumo, "handleVoiceServerUpdate");

    let rawListener: ((packet: any) => void) | undefined;
    const sendMock = vi.fn();

    const mockClient = {
      on: vi.fn((event: string, listener: any) => {
        if (event === "raw") rawListener = listener;
      }),
      guilds: { cache: { get: () => ({ shardId: 0, shard: { send: sendMock } }) } },
    };

    const adapter = new DiscordJSAdapter(mockClient as any, kumo);
    expect(rawListener).toBeDefined();

    rawListener?.({
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: "123", session_id: "sess1", channel_id: "456", user_id: "789" },
    });
    expect(voiceStateSpy).toHaveBeenCalledWith({
      guildId: "123",
      sessionId: "sess1",
      channelId: "456",
      userId: "789",
    });

    rawListener?.({
      t: "VOICE_SERVER_UPDATE",
      d: { guild_id: "123", token: "tok1", endpoint: "ep1" },
    });
    expect(voiceServerSpy).toHaveBeenCalledWith("123", { token: "tok1", endpoint: "ep1" });

    adapter.sendVoiceStateUpdate("123", "456", true, false);
    expect(sendMock).toHaveBeenCalledWith({
      op: 4,
      d: { guild_id: "123", channel_id: "456", self_deaf: true, self_mute: false },
    });
  });

  it("ErisAdapter should handle rawWS events and send voice state updates", () => {
    const kumo = new YuKumo({ nodes: [] });
    const voiceStateSpy = vi.spyOn(kumo, "handleVoiceStateUpdate");

    let rawWsListener: ((packet: any) => void) | undefined;
    const sendWsMock = vi.fn();

    const mockErisClient = {
      on: vi.fn((event: string, listener: any) => {
        if (event === "rawWS") rawWsListener = listener;
      }),
      getGuildShard: () => ({ sendWS: sendWsMock }),
    };

    const adapter = new ErisAdapter(mockErisClient as any, kumo);
    expect(rawWsListener).toBeDefined();

    rawWsListener?.({
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: "999", session_id: "sess9", channel_id: "888", user_id: "777" },
    });
    expect(voiceStateSpy).toHaveBeenCalled();

    adapter.sendVoiceStateUpdate("999", "888");
    expect(sendWsMock).toHaveBeenCalledWith(4, {
      guild_id: "999",
      channel_id: "888",
      self_deaf: true,
      self_mute: false,
    });
  });

  it("RawGatewayAdapter should process raw packets and build voice state payload", () => {
    const kumo = new YuKumo({ nodes: [] });
    const voiceServerSpy = vi.spyOn(kumo, "handleVoiceServerUpdate");
    const adapter = new RawGatewayAdapter(kumo);

    adapter.handleRawPacket({
      t: "VOICE_SERVER_UPDATE",
      d: { guild_id: "111", token: "tok", endpoint: "ep" },
    });
    expect(voiceServerSpy).toHaveBeenCalledWith("111", { token: "tok", endpoint: "ep" });

    const payload = adapter.buildVoiceStatePayload("111", "222");
    expect(payload).toEqual({
      op: 4,
      d: { guild_id: "111", channel_id: "222", self_deaf: true, self_mute: false },
    });
  });

  it("DaveyAdapter should process raw packets, forward CHANNEL_DELETE and build the voice state payload", () => {
    const kumo = new YuKumo({ nodes: [] });
    const voiceServerSpy = vi.spyOn(kumo, "handleVoiceServerUpdate");
    const channelDeleteSpy = vi.spyOn(kumo, "handleChannelDelete");
    const adapter = new DaveyAdapter(kumo);

    adapter.handleRawPacket({
      t: "VOICE_SERVER_UPDATE",
      d: { guild_id: "333", token: "tok_dave", endpoint: "ep_dave" },
    });
    expect(voiceServerSpy).toHaveBeenCalledWith("333", { token: "tok_dave", endpoint: "ep_dave" });

    adapter.handleRawPacket({ t: "CHANNEL_DELETE", d: { guild_id: "333", id: "444" } });
    expect(channelDeleteSpy).toHaveBeenCalledWith("333", "444");

    const payload = adapter.buildVoiceStatePayload("333", "444");
    expect(payload).toEqual({
      op: 4,
      d: { guild_id: "333", channel_id: "444", self_deaf: true, self_mute: false },
    });
  });

  it("DiscordenoAdapter should forward voice events and CHANNEL_DELETE", () => {
    const kumo = new YuKumo({ nodes: [] });
    const channelDeleteSpy = vi.spyOn(kumo, "handleChannelDelete");
    const adapter = new DiscordenoAdapter(kumo);

    adapter.handleRaw({ t: "CHANNEL_DELETE", d: { guild_id: "555", id: "666" } });
    expect(channelDeleteSpy).toHaveBeenCalledWith("555", "666");
  });

  it("SeyfertAdapter should route OP4 to the guild's shard and detach rawWS on destroy", () => {
    const kumo = new YuKumo({ nodes: [] });
    const sendMock = vi.fn();
    const unsubscribeMock = vi.fn();
    let rawListener: ((packet: unknown) => void) | undefined;

    const mockSeyfertClient = {
      events: {
        rawWS: vi.fn((listener: (packet: unknown) => void) => {
          rawListener = listener;
          return unsubscribeMock;
        }),
      },
      gateway: { send: sendMock, shardsCount: 4 },
    };

    const adapter = new SeyfertAdapter(mockSeyfertClient as any, kumo);
    expect(rawListener).toBeDefined();

    adapter.sendVoiceStateUpdate("123456789012345678", "456");
    const expectedShard = Number((BigInt("123456789012345678") >> 22n) % 4n);
    expect(sendMock).toHaveBeenCalledWith(expectedShard, {
      op: 4,
      d: { guild_id: "123456789012345678", channel_id: "456", self_deaf: true, self_mute: false },
    });

    adapter.destroy();
    expect(unsubscribeMock).toHaveBeenCalled();
  });
});
