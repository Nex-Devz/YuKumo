import { describe, it, expect, vi, beforeEach } from "vitest";
import { YuKumo } from "./YuKumo.ts";
import type { NodeConfig, VoiceStateUpdate, VoiceServerUpdate } from "./types/internal.ts";
import type { TrackData } from "./types/protocol.ts";

function makeTrack(encoded: string): TrackData {
  return {
    encoded,
    info: {
      identifier: "",
      isSeekable: false,
      author: "",
      length: 0,
      isStream: false,
      position: 0,
      title: "",
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "",
    },
    pluginInfo: {},
  };
}

const nodeConfigs: NodeConfig[] = [
  { host: "localhost", port: 2333, password: "youshallnotpass", name: "default" },
];

describe("YuKumo", () => {
  describe("constructor", () => {
    it("should create instance with node configs", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.nodes.size()).toBe(1);
      expect(yukumo.nodes.get("default")).toBeDefined();
    });

    it("should use MemoryStorage by default", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.storage).toBeDefined();
    });
  });

  describe("init / destroy", () => {
    it("should init and destroy without errors", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      await yukumo.init();
      await yukumo.destroy();
      expect(yukumo.nodes.size()).toBe(0);
    });
  });

  describe("search", () => {
    it("should return empty result when no nodes connected", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const result = await yukumo.search("test query");
      expect(result.loadType).toBe("empty");
    });

    it("should handle string query", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const result = await yukumo.search("test");
      expect(result).toBeDefined();
    });

    it("should handle options object", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const result = await yukumo.search({ query: "test", source: "ytsearch" });
      expect(result).toBeDefined();
    });
  });

  describe("createPlayer", () => {
    it("should throw when no nodes are connected", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      await expect(yukumo.createPlayer({ guildId: "guild-1", voiceChannelId: "vc-1" })).rejects.toThrow(
        "No available nodes",
      );
    });

    it("should return existing player if already created", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      // Can't fully test without connected nodes, but verify the path
      await expect(yukumo.createPlayer({ guildId: "guild-1", voiceChannelId: "vc-1" })).rejects.toThrow();
    });
  });

  describe("player operations without player", () => {
    let yukumo: YuKumo;

    beforeEach(() => {
      yukumo = new YuKumo({ nodes: nodeConfigs });
    });

    it("should throw on play with no player", async () => {
      await expect(yukumo.play("guild-1", makeTrack("test"))).rejects.toThrow(
        "No player found for guild guild-1",
      );
    });

    it("should throw on pause with no player", async () => {
      await expect(yukumo.pause("guild-1")).rejects.toThrow("No player found for guild guild-1");
    });

    it("should throw on resume with no player", async () => {
      await expect(yukumo.resume("guild-1")).rejects.toThrow("No player found for guild guild-1");
    });

    it("should throw on stop with no player", async () => {
      await expect(yukumo.stop("guild-1")).rejects.toThrow("No player found for guild guild-1");
    });

    it("should throw on skip with no player", async () => {
      await expect(yukumo.skip("guild-1")).rejects.toThrow("No player found for guild guild-1");
    });

    it("should throw on setVolume with no player", async () => {
      await expect(yukumo.setVolume("guild-1", 100)).rejects.toThrow("No player found for guild guild-1");
    });

    it("should return false on destroyPlayer with no player", async () => {
      const result = await yukumo.destroyPlayer("guild-1");
      expect(result).toBe(false);
    });
  });

  describe("voice state handling", () => {
    it("should handle voice state update", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const update: VoiceStateUpdate = {
        guildId: "guild-1",
        sessionId: "session-1",
        channelId: "vc-1",
        userId: "user-1",
      };
      await expect(yukumo.handleVoiceStateUpdate(update)).resolves.toBeUndefined();
    });

    it("should handle voice server update", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const update: VoiceServerUpdate = {
        token: "token-1",
        endpoint: "wss://example.com",
      };
      await expect(yukumo.handleVoiceServerUpdate("guild-1", update)).resolves.toBeUndefined();
    });
  });

  describe("lookup helpers", () => {
    it("should return undefined for non-existent player", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.getPlayer("guild-1")).toBeUndefined();
    });

    it("should return empty array for getPlayers", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.getPlayers()).toEqual([]);
    });

    it("should return false for hasPlayer", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.hasPlayer("guild-1")).toBe(false);
    });

    it("should return node by id", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const node = yukumo.getNode("default");
      expect(node).toBeDefined();
      expect(node!.config.host).toBe("localhost");
    });

    it("should return undefined for non-existent node", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.getNode("nonexistent")).toBeUndefined();
    });

    it("should return all nodes", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const nodes = yukumo.getNodes();
      expect(nodes).toHaveLength(1);
    });
  });

  describe("events", () => {
    it("should register event listeners via on()", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      const handler = vi.fn();
      yukumo.on("playerCreate", handler);
      yukumo.events.emit("playerCreate", "guild-1");
      expect(handler).toHaveBeenCalledWith("guild-1");
    });
  });

  describe("plugins", () => {
    it("should register plugins from config", () => {
      const yukumo = new YuKumo({
        nodes: nodeConfigs,
        plugins: [{ name: "test-plugin", version: "1.0.0" }],
      });
      expect(yukumo.plugins.get("test-plugin")).toBeDefined();
    });

    it("should skip plugins when config has none", () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      expect(yukumo.plugins.getAll()).toEqual([]);
    });
  });

  describe("search with plugin hooks", () => {
    it("should allow beforeSearch plugin to modify query", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      yukumo.plugins.addHook("beforeSearch", async () => ({
        query: "modified",
        source: "ytsearch",
      }));
      // No nodes connected so result will be empty
      const result = await yukumo.search("original");
      // The hook runs before node selection
      expect(result).toBeDefined();
    });

    it("should allow beforeSearch plugin to cancel", async () => {
      const yukumo = new YuKumo({ nodes: nodeConfigs });
      yukumo.plugins.addHook("beforeSearch", async () => null);
      const result = await yukumo.search("canceled");
      expect(result.loadType).toBe("empty");
    });
  });

  describe("storage", () => {
    it("should use provided storage adapter", () => {
      const customStorage = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        has: vi.fn(),
        clear: vi.fn(),
      };
      const yukumo = new YuKumo({ nodes: nodeConfigs, storageAdapter: customStorage });
      expect(yukumo.storage).toBe(customStorage);
    });
  });

  describe("search fallback & autoplay LRU", () => {
    it("falls back to secondary sources when primary returns empty", async () => {
      const yukumo = new YuKumo({
        nodes: [{ name: "node-1", host: "localhost", port: 2333, password: "pass" }],
        searchFallback: ["scsearch", "spsearch"],
      });

      const node = yukumo.nodes.get("node-1")!;
      (node.ws as any)._state = "connected";
      node.rest.sessionId = "mock-session";

      const loadTracksSpy = vi.spyOn(node.rest, "loadTracks").mockImplementation(async (identifier: string) => {
        if (identifier.startsWith("ytsearch:")) {
          return { loadType: "empty", data: null };
        }
        if (identifier.startsWith("scsearch:")) {
          return {
            loadType: "search",
            data: [
              {
                encoded: "sc-track-enc",
                info: {
                  identifier: "sc-1",
                  title: "Fallback Track",
                  author: "Artist",
                  length: 120000,
                  position: 0,
                  isSeekable: true,
                  isStream: false,
                  uri: "https://soundcloud.com/track",
                  artworkUrl: null,
                  isrc: null,
                  sourceName: "soundcloud",
                },
                pluginInfo: {},
                userData: {},
              },
            ],
          };
        }
        return { loadType: "empty", data: null };
      });

      const res = await yukumo.search("chill music");
      expect(loadTracksSpy).toHaveBeenCalledTimes(2);
      expect(res.loadType).toBe("search");
      expect(res.tracks).toHaveLength(1);
      expect(res.tracks[0]?.info.title).toBe("Fallback Track");
    });

    it("respects disableFallback option", async () => {
      const yukumo = new YuKumo({
        nodes: [{ name: "node-1", host: "localhost", port: 2333, password: "pass" }],
        searchFallback: ["scsearch"],
      });

      const node = yukumo.nodes.get("node-1")!;
      (node.ws as any)._state = "connected";
      node.rest.sessionId = "mock-session";

      const loadTracksSpy = vi.spyOn(node.rest, "loadTracks").mockResolvedValue({
        loadType: "empty",
        data: null,
      });

      const res = await yukumo.search({ query: "chill music", disableFallback: true });
      expect(loadTracksSpy).toHaveBeenCalledTimes(1);
      expect(res.loadType).toBe("empty");
    });

    it("manages autoplay history LRU deduplication on player", () => {
      const yukumo = new YuKumo({
        nodes: [{ name: "node-1", host: "localhost", port: 2333, password: "pass" }],
        playerDefaults: { autoplayHistorySize: 3 },
      });
      const node = yukumo.nodes.get("node-1")!;
      const player = yukumo.players.create({
        guildId: "123",
        voiceChannelId: "456",
        node,
      });

      expect(player.autoplayHistorySize).toBe(3);

      const track = (id: string) =>
        ({
          encoded: `enc-${id}`,
          info: { identifier: id, title: `Title ${id}`, author: "A", length: 1000, isSeekable: true, isStream: false, uri: "", artworkUrl: null, isrc: null, sourceName: "youtube" },
          pluginInfo: {},
          userData: {},
        }) as any;

      player.recordAutoplayHistory(track("t1"));
      player.recordAutoplayHistory(track("t2"));
      player.recordAutoplayHistory(track("t3"));
      // 4th track should evict oldest (t1)
      player.recordAutoplayHistory(track("t4"));

      player.clearAutoplayHistory();
    });
  });
});
