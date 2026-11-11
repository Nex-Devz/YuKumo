import { describe, it, expect, vi } from "vitest";
import { PrometheusExporter } from "./PrometheusExporter.ts";
import { YuKumo } from "../YuKumo.ts";
import { Queue } from "../queue/Queue.ts";
import { SeyfertAdapter } from "../adapters/SeyfertAdapter.ts";
import { OceanicAdapter } from "../adapters/OceanicAdapter.ts";
import { DiscordenoAdapter } from "../adapters/DiscordenoAdapter.ts";

describe("PrometheusExporter & Advanced Features", () => {
  it("PrometheusExporter should render openmetrics string", () => {
    const kumo = new YuKumo({
      nodes: [{ host: "127.0.0.1", port: 2333, password: "test", name: "node-1" }],
    });

    const exporter = new PrometheusExporter(kumo);
    const metrics = exporter.renderMetrics();

    expect(metrics).toContain("yukumo_connected_nodes");
    expect(metrics).toContain("yukumo_active_players");
  });

  it("Queue getPage should return correct pagination slice", () => {
    const queue = new Queue<string>();
    for (let i = 1; i <= 25; i++) {
      queue.enqueue(`track-${i}`);
    }
    queue.start(); // current is track-1 at index 0

    const page1 = queue.getPage(1, 10);
    expect(page1.tracks.length).toBe(10);
    expect(page1.tracks[0]).toBe("track-2");
    expect(page1.page).toBe(1);
    expect(page1.totalPages).toBe(3);

    const page3 = queue.getPage(3, 10);
    expect(page3.tracks.length).toBe(4);
    expect(page3.page).toBe(3);
  });

  it("SeyfertAdapter should dispatch voice updates", () => {
    const kumo = new YuKumo({ nodes: [] });
    const voiceStateSpy = vi.spyOn(kumo, "handleVoiceStateUpdate");

    let rawWsCallback: ((packet: any) => void) | undefined;
    const mockSeyfertClient = {
      events: {
        rawWS: (cb: any) => {
          rawWsCallback = cb;
        },
      },
      gateway: { send: vi.fn() },
    };

    const adapter = new SeyfertAdapter(mockSeyfertClient, kumo);
    expect(rawWsCallback).toBeDefined();

    rawWsCallback?.({
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: "s1", session_id: "sess1", channel_id: "vc1", user_id: "u1" },
    });
    expect(voiceStateSpy).toHaveBeenCalledWith({
      guildId: "s1",
      sessionId: "sess1",
      channelId: "vc1",
      userId: "u1",
    });

    adapter.sendVoiceStateUpdate("s1", "vc1");
    expect(mockSeyfertClient.gateway.send).toHaveBeenCalled();
  });

  it("OceanicAdapter and DiscordenoAdapter should process packets", () => {
    const kumo = new YuKumo({ nodes: [] });
    const voiceServerSpy = vi.spyOn(kumo, "handleVoiceServerUpdate");

    let packetCallback: ((packet: any) => void) | undefined;
    const mockOceanic = {
      on: (event: string, cb: any) => {
        if (event === "packet") packetCallback = cb;
      },
    };

    new OceanicAdapter(mockOceanic, kumo);
    packetCallback?.({
      t: "VOICE_SERVER_UPDATE",
      d: { guild_id: "o1", token: "tok1", endpoint: "ep1" },
    });
    expect(voiceServerSpy).toHaveBeenCalledWith("o1", { token: "tok1", endpoint: "ep1" });

    const discordeno = new DiscordenoAdapter(kumo);
    const payload = discordeno.buildVoiceStatePayload("d1", "vc1");
    expect(payload.d.guild_id).toBe("d1");
  });
});
