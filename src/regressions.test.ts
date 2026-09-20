import { describe, it, expect, vi, beforeEach } from "vitest";
import { YuKumo } from "./Kumo.ts";
import type { NodeConfig, VoiceStateUpdate } from "./types/internal.ts";
import type { TrackData } from "./types/protocol.ts";
import { DestroyReasons } from "./types/constants.ts";
import type { Node } from "./node/Node.ts";

function makeTrack(encoded: string): TrackData {
  return {
    encoded,
    info: {
      identifier: encoded,
      isSeekable: true,
      author: "A",
      length: 1000,
      isStream: false,
      position: 0,
      title: encoded,
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "youtube",
    },
    pluginInfo: {},
  };
}

const nodeConfigs: NodeConfig[] = [
  { host: "localhost", port: 2333, password: "pw", name: "main" },
];

function silenceWs(node: Node | undefined): void {
  Object.defineProperty(node!.ws, "eventDispatcher", {
    value: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    configurable: true,
  });
  Object.defineProperty(node!.rest, "sessionId", { value: "sess", writable: true, configurable: true });
  Object.defineProperty(node!, "state", { value: "connected", configurable: true });
}

function createKumo(): YuKumo {
  const kumo = new YuKumo({ nodes: nodeConfigs });
  silenceWs(kumo.nodes.get("main")!);
  return kumo;
}

describe("bug regressions", () => {
  let kumo: YuKumo;
  let node: Node;

  beforeEach(() => {
    kumo = createKumo();
    node = kumo.nodes.get("main")!;
    node.rest.updatePlayer = vi.fn().mockResolvedValue({});
    node.rest.loadTracks = vi.fn().mockResolvedValue({ loadType: "empty", data: null });
  });

  describe("playTrack status rollback", () => {
    it("restores 'playing' (not 'idle') when a play on top of a playing track fails", async () => {
      const player = kumo.players.create({
        guildId: "g1",
        node,
        voiceChannelId: "vc",
      });
      player.setVoiceState({ sessionId: "s1", channelId: "vc", endpoint: "wss://ep", token: "tok" });
      player.queue.enqueue(makeTrack("AAA"));

      await player.playTrack(makeTrack("AAA"));
      expect(player.status).toBe("playing");

      node.rest.updatePlayer = vi.fn().mockRejectedValue(new Error("node rejected"));

      await expect(player.playTrack(makeTrack("BBB"))).rejects.toThrow("node rejected");
      // The previous track is still audible — status must stay "playing", not "idle"
      expect(player.status).toBe("playing");
    });

    it("restores 'idle' when a first-time play fails", async () => {
      const player = kumo.players.create({
        guildId: "g2",
        node,
        voiceChannelId: "vc",
      });
      player.setVoiceState({ sessionId: "s1", channelId: "vc", endpoint: "wss://ep", token: "tok" });
      node.rest.updatePlayer = vi.fn().mockRejectedValue(new Error("node rejected"));

      await expect(player.playTrack(makeTrack("AAA"))).rejects.toThrow("node rejected");
      expect(player.status).toBe("idle");
    });
  });

  describe("VOICE_STATE_UPDATE bot filter", () => {
    it("ignores other members' state updates when the bot user ID is unset", async () => {
      const player = kumo.players.create({
        guildId: "g3",
        node,
        voiceChannelId: "vc",
      });
      const destroySpy = vi.spyOn(player, "destroy").mockResolvedValue(undefined);

      // kumo._userId is "" — a foreign member leaving voice must not destroy the player
      const foreignUpdate: VoiceStateUpdate = {
        guildId: "g3",
        sessionId: "s1",
        channelId: null,
        userId: "some-member",
      };
      await kumo.handleVoiceStateUpdate(foreignUpdate);

      expect(destroySpy).not.toHaveBeenCalled();
      expect(player.destroyed).toBe(false);
    });

    it("accepts the bot's own state update", async () => {
      kumo.setUserId("bot-id");
      const player = kumo.players.create({
        guildId: "g4",
        node,
        voiceChannelId: "vc",
      });

      const ownUpdate: VoiceStateUpdate = {
        guildId: "g4",
        sessionId: "s1",
        channelId: "vc",
        userId: "bot-id",
      };
      await kumo.handleVoiceStateUpdate(ownUpdate);

      expect(player.destroyed).toBe(false);
      expect(player.voiceChannelId).toBe("vc");
    });
  });

  describe("voice socket close codes", () => {
    it("rejoins the channel on Discord close code 4014", async () => {
      const player = kumo.players.create({
        guildId: "g5",
        node,
        voiceChannelId: "vc",
      });
      const connectSpy = vi.spyOn(player, "connect");

      // 4014 (Disconnected) — node reported the voice socket dropped
      (kumo as unknown as { handleVoiceSocketClosed(g: string, c: number): void })
        .handleVoiceSocketClosed("g5", 4014);

      expect(connectSpy).toHaveBeenCalled();
    });
  });

  describe("search source prefixes", () => {
    it("maps NodeLink source names to search prefixes", async () => {
      await kumo.search("never gonna give you up", "bandcamp");
      expect(node.rest.loadTracks).toHaveBeenCalledWith("bcsearch:never gonna give you up");
    });

    it("passes the server's selectedTrack through for playlists", async () => {
      node.rest.loadTracks = vi.fn().mockResolvedValue({
        loadType: "playlist",
        data: {
          info: { name: "P", selectedTrack: 3 },
          pluginInfo: {},
          tracks: [makeTrack("A"), makeTrack("B")],
        },
      });

      const result = await kumo.search("https://example.com/playlist");
      expect(result.loadType).toBe("playlist");
      expect((result as { playlistInfo: { selectedTrack: number } }).playlistInfo.selectedTrack).toBe(3);
    });
  });

  describe("voice disconnect clears stale credentials", () => {
    it("resets voice state before auto-reconnect so playback waits for fresh creds", async () => {
      const player = kumo.players.create({
        guildId: "g6",
        node,
        voiceChannelId: "vc",
      });
      player.setVoiceState({ sessionId: "old", channelId: "vc", endpoint: "wss://old", token: "tok" });

      // Simulate the autoReconnect path invoked by handleVoiceDisconnect
      player.resetVoiceState();

      expect(player.hasVoiceCredentials).toBe(false);
    });
  });

  it("destroys a player on voice channel leave when configured", async () => {
    const kumo2 = new YuKumo({ nodes: nodeConfigs });
    silenceWs(kumo2.nodes.get("main")!);
    const n2 = kumo2.nodes.get("main")!;
    const player = kumo2.players.create({ guildId: "g7", node: n2, voiceChannelId: "vc" });
    const destroySpy = vi.spyOn(player, "destroy").mockResolvedValue(undefined);
    kumo2.setUserId("bot-id");

    await kumo2.handleVoiceStateUpdate({
      guildId: "g7",
      sessionId: "s1",
      channelId: null,
      userId: "bot-id",
    });

    expect(destroySpy).toHaveBeenCalledWith(DestroyReasons.Disconnected);
  });

  describe("node failover vs session resuming", () => {
    function resumingKumo() {
      const kumo = new YuKumo({
        nodes: [
          { host: "a.example", port: 2333, password: "p", name: "main", resuming: true, resumeTimeout: 60 },
          { host: "b.example", port: 2333, password: "p", name: "backup" },
        ],
      });
      const main = kumo.getNode("main")!;
      const backup = kumo.getNode("backup")!;
      main.rest.sessionId = "sess-main";
      main.rest.updatePlayer = vi.fn().mockResolvedValue({});
      backup.rest.sessionId = "sess-backup";
      backup.rest.updatePlayer = vi.fn().mockResolvedValue({});
      // Only the backup remains selectable after the main node's disconnect
      Object.defineProperty(main.ws, "state", { get: () => "disconnected", configurable: true });
      Object.defineProperty(backup.ws, "state", { get: () => "connected", configurable: true });
      return { kumo, main, backup };
    }

    it("defers failover for the resume window and cancels when the node reconnects", async () => {
      vi.useFakeTimers();
      try {
        const { kumo, main } = resumingKumo();
        const player = kumo.players.create({ guildId: "g-f1", node: main, voiceChannelId: "vc" });
        player.setVoiceState({ sessionId: "s1", channelId: "vc", endpoint: "wss://ep", token: "tok" });
        const setNodeSpy = vi.spyOn(player, "setNode");

        // A transient blip must NOT migrate players while the session can resume
        main.ws.eventDispatcher.emit("nodeDisconnected", "main", 1006, "network");
        expect(setNodeSpy).not.toHaveBeenCalled();

        // The node reconnects inside the resume window → failover is cancelled
        main.ws.eventDispatcher.emit("nodeReady", "main");
        await vi.advanceTimersByTimeAsync(61_000);
        expect(setNodeSpy).not.toHaveBeenCalled();
        expect(player.node).toBe(main);
      } finally {
        vi.useRealTimers();
      }
    });

    it("fails players over after the resume window elapses when the node stays down", async () => {
      vi.useFakeTimers();
      try {
        const { kumo, main, backup } = resumingKumo();
        const player = kumo.players.create({ guildId: "g-f2", node: main, voiceChannelId: "vc" });
        player.setVoiceState({ sessionId: "s1", channelId: "vc", endpoint: "wss://ep", token: "tok" });
        const setNodeSpy = vi.spyOn(player, "setNode");

        main.ws.eventDispatcher.emit("nodeDisconnected", "main", 1006, "network");
        expect(setNodeSpy).not.toHaveBeenCalled();

        // Never reconnects — after the resume window the player must migrate
        await vi.advanceTimersByTimeAsync(61_000);
        expect(setNodeSpy).toHaveBeenCalledWith(backup);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});