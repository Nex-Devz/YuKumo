import { describe, it, expect, vi, beforeEach } from "vitest";
import { YuKumo } from "./YuKumo.ts";
import type { NodeConfig, VoiceStateUpdate } from "./types/internal.ts";
import type { TrackData } from "./types/protocol.ts";
import { DestroyReasons } from "./types/constants.ts";
import type { Node } from "./node/Node.ts";
import { buildCapabilities } from "./node/capabilities.ts";
import { TTLCache } from "./utils/TTLCache.ts";
import { Queue } from "./queue/Queue.ts";
import { NodeManager } from "./node/NodeManager.ts";
import { EventDispatcher } from "./ws/EventDispatcher.ts";
import { decodeTrackInfo } from "./tracks/TrackEncoder.ts";
import { PrometheusExporter } from "./metrics/PrometheusExporter.ts";

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

const nodeConfigs: NodeConfig[] = [{ host: "localhost", port: 2333, password: "pw", name: "main" }];

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
      (kumo as unknown as { handleVoiceSocketClosed(g: string, c: number): void }).handleVoiceSocketClosed(
        "g5",
        4014,
      );

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

    it("destroys player on old node during voluntary setNode migration", async () => {
      const { kumo, main, backup } = resumingKumo();
      Object.defineProperty(main.ws, "state", { get: () => "connected", configurable: true });
      main.rest.destroyPlayer = vi.fn().mockResolvedValue(undefined);
      const player = kumo.players.create({ guildId: "g-clean", node: main, voiceChannelId: "vc" });
      player.setVoiceState({ sessionId: "s1", channelId: "vc", endpoint: "wss://ep", token: "tok" });

      await player.setNode(backup);
      expect(main.rest.destroyPlayer).toHaveBeenCalledWith("sess-main", "g-clean");
      expect(player.node).toBe(backup);
    });

    it("initializes storage adapter with connect() hook in kumo.init()", async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        has: vi.fn().mockResolvedValue(false),
        clear: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn().mockResolvedValue(undefined),
      };

      const k = new YuKumo({ nodes: nodeConfigs, storageAdapter: mockStorage });
      silenceWs(k.nodes.get("main")!);
      await k.init();
      expect(mockStorage.connect).toHaveBeenCalled();
    });

    it("detects Lavalink plugin capabilities from info.plugins", () => {
      const info = {
        version: { semver: "4.0.0", major: 4, minor: 0, patch: 0, preRelease: null, build: null },
        buildTime: 0,
        git: { branch: "main", commit: "abc", commitTime: 0 },
        jvm: "21",
        lavaplayer: "2.0",
        sourceManagers: ["youtube"],
        filters: ["volume"],
        plugins: [
          { name: "lavalyrics-plugin", version: "1.0.0" },
          { name: "sponsorblock-plugin", version: "1.0.0" },
        ],
      };

      const caps = buildCapabilities("lavalink", info);
      expect(caps.features.has("lyrics")).toBe(true);
      expect(caps.features.has("lyricsSubscribe")).toBe(true);
      expect(caps.features.has("sponsorblock")).toBe(true);
    });

    it("auto-wires sendGatewayPayload when an adapter is registered", () => {
      const k = new YuKumo({ nodes: [] });
      expect(k.sendGatewayPayload).toBeUndefined();

      const sent: any[] = [];
      const dummyAdapter = {
        destroy: vi.fn(),
        sendVoiceStateUpdate: (
          guildId: string,
          channelId: string | null,
          selfDeaf?: boolean,
          selfMute?: boolean,
        ) => {
          sent.push({ guildId, channelId, selfDeaf, selfMute });
        },
      };

      k.registerAdapter(dummyAdapter);
      expect(typeof k.sendGatewayPayload).toBe("function");

      k.sendGatewayPayload!("123", {
        op: 4,
        d: { guild_id: "123", channel_id: "456", self_deaf: true, self_mute: false },
      });

      expect(sent).toEqual([{ guildId: "123", channelId: "456", selfDeaf: true, selfMute: false }]);
    });

    it("forwards YuKumo instance to plugin init hook", async () => {
      let passedManager: any = null;
      const k = new YuKumo({
        nodes: [],
        plugins: [
          {
            name: "test-plugin",
            version: "1.0.0",
            init: (mgr) => {
              passedManager = mgr;
            },
          },
        ],
      });

      await k.plugins.ready();
      expect(passedManager).toBe(k);
    });

    it("wires defaultNodeSelector into NodeManager", () => {
      const customSelector = {
        pick: vi.fn().mockReturnValue(null),
      };
      const k = new YuKumo({
        nodes: [],
        defaultNodeSelector: customSelector,
      });

      // Internal NodeManager selector should be wired
      const selected = (k.nodes as any).selector;
      expect(selected).toBe(customSelector);
    });

    it("bounds TTLCache size and evicts on capacity", () => {
      const cache = new TTLCache(3);
      cache.set("a", 1, 10);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.size).toBe(3);

      // Adding 4th item when capacity is 3: sweeps expired or evicts oldest
      cache.set("d", 4);
      expect(cache.size).toBeLessThanOrEqual(3);
      expect(cache.has("d")).toBe(true);
    });

    it("retains detached track in queue.currentTrack when dequeueing active track", () => {
      const q = new Queue<TrackData>();
      const t1 = makeTrack("track-1");
      const t2 = makeTrack("track-2");
      q.enqueue(t1);
      q.enqueue(t2);
      q.start();

      expect(q.currentTrack?.info.identifier).toBe("track-1");

      const removed = q.dequeue(0);
      expect(removed?.info.identifier).toBe("track-1");
      // Must not be null or shifted abruptly while audio is still playing
      expect(q.currentTrack?.info.identifier).toBe("track-1");

      // Once next is called, detached track moves to history and advances
      const nextTrack = q.next();
      expect(nextTrack?.info.identifier).toBe("track-2");
      expect(q.historyList[0]?.info.identifier).toBe("track-1");
    });

    it("createPlayer replaces destroyed player instead of returning dead husk", async () => {
      const k = new YuKumo({ nodes: nodeConfigs });
      const n = k.nodes.get("main")!;
      silenceWs(n);
      n.rest.destroyPlayer = vi.fn().mockResolvedValue(undefined);
      const player1 = await k.createPlayer({ guildId: "husk-guild", voiceChannelId: "vc-1" });
      player1.setVoiceState({ sessionId: "s1", channelId: "vc-1", endpoint: "wss://ep", token: "tok" });
      await player1.destroy();
      expect(player1.destroyed).toBe(true);

      // Re-creating player for same guild should return a new, non-destroyed instance
      const player2 = await k.createPlayer({ guildId: "husk-guild", voiceChannelId: "vc-1" });
      expect(player2).not.toBe(player1);
      expect(player2.destroyed).toBe(false);
    });

    it("NodeManager.destroyAll calls destroy on each node", async () => {
      const mgr = new NodeManager("user-1");
      const n1 = mgr.add({ host: "localhost", port: 2333, password: "youshallnotpass", name: "n1" });
      const n2 = mgr.add({ host: "localhost", port: 2334, password: "youshallnotpass", name: "n2" });

      const d1Spy = vi.spyOn(n1, "destroy");
      const d2Spy = vi.spyOn(n2, "destroy");
      const c1Spy = vi.spyOn(n1, "close").mockResolvedValue(undefined as never);
      const c2Spy = vi.spyOn(n2, "close").mockResolvedValue(undefined as never);

      await mgr.destroyAll();

      expect(c1Spy).toHaveBeenCalled();
      expect(c2Spy).toHaveBeenCalled();
      expect(d1Spy).toHaveBeenCalled();
      expect(d2Spy).toHaveBeenCalled();
      expect(mgr.getAll().length).toBe(0);
    });

    it("Queue supports add(tracks[]), enqueueMany, and computes duration", () => {
      const q = new Queue();
      const t1 = { ...makeTrack("t1"), info: { ...makeTrack("t1").info, length: 30000 } };
      const t2 = { ...makeTrack("t2"), info: { ...makeTrack("t2").info, length: 45000 } };
      const t3 = { ...makeTrack("t3"), info: { ...makeTrack("t3").info, length: 15000 } };

      let changedCount = 0;
      q.onChanged = () => changedCount++;

      // Batch add
      q.add([t1, t2]);
      expect(q.size).toBe(2);
      expect(changedCount).toBe(1);

      // enqueueMany
      q.enqueueMany([t3]);
      expect(q.size).toBe(3);
      expect(changedCount).toBe(2);

      // Total duration
      expect(q.duration).toBe(90000);
    });

    it("Player.restart seeks to 0", async () => {
      const player = kumo.players.create({ guildId: "restart-guild", node, voiceChannelId: "vc-1" });
      player.seek = vi.fn().mockResolvedValue(undefined);
      player.queue.add(makeTrack("now-playing"));
      player.queue.start();

      await player.restart();
      expect(player.seek).toHaveBeenCalledWith(0);
    });

    it("EventDispatcher supports EventEmitter aliases", () => {
      const d = new EventDispatcher();
      const fn = vi.fn();

      d.addListener("nodeReady", fn);
      expect(d.listenerCount("nodeReady")).toBe(1);
      expect(d.eventNames()).toContain("nodeReady");
      expect(d.listeners("nodeReady")).toEqual([fn]);

      d.setMaxListeners(20);
      expect(d.getMaxListeners()).toBe(20);

      d.removeListener("nodeReady", fn);
      expect(d.listenerCount("nodeReady")).toBe(0);
    });

    it("decodes Lavalink v3 track format with artworkUrl and isrc", () => {
      // Build a v3 buffer
      const buf = Buffer.alloc(256);
      let pos = 0;
      buf.writeInt32BE((1 << 30) | 120, pos);
      pos += 4;
      buf.writeUInt8(3, pos);
      pos += 1; // version 3
      // title
      const tBuf = Buffer.from("V3 Title", "utf8");
      buf.writeUInt16BE(tBuf.length, pos);
      pos += 2;
      tBuf.copy(buf, pos);
      pos += tBuf.length;
      // author
      const aBuf = Buffer.from("V3 Author", "utf8");
      buf.writeUInt16BE(aBuf.length, pos);
      pos += 2;
      aBuf.copy(buf, pos);
      pos += aBuf.length;
      // length
      buf.writeBigInt64BE(60000n, pos);
      pos += 8;
      // identifier
      const idBuf = Buffer.from("v3-id", "utf8");
      buf.writeUInt16BE(idBuf.length, pos);
      pos += 2;
      idBuf.copy(buf, pos);
      pos += idBuf.length;
      // isStream
      buf.writeUInt8(0, pos);
      pos += 1;
      // hasUri + uri
      buf.writeUInt8(1, pos);
      pos += 1;
      const uBuf = Buffer.from("https://example.com", "utf8");
      buf.writeUInt16BE(uBuf.length, pos);
      pos += 2;
      uBuf.copy(buf, pos);
      pos += uBuf.length;
      // hasArtworkUrl + artworkUrl
      buf.writeUInt8(1, pos);
      pos += 1;
      const artBuf = Buffer.from("https://example.com/art.jpg", "utf8");
      buf.writeUInt16BE(artBuf.length, pos);
      pos += 2;
      artBuf.copy(buf, pos);
      pos += artBuf.length;
      // hasIsrc + isrc
      buf.writeUInt8(1, pos);
      pos += 1;
      const isrcBuf = Buffer.from("US1234567890", "utf8");
      buf.writeUInt16BE(isrcBuf.length, pos);
      pos += 2;
      isrcBuf.copy(buf, pos);
      pos += isrcBuf.length;
      // source
      const sBuf = Buffer.from("youtube", "utf8");
      buf.writeUInt16BE(sBuf.length, pos);
      pos += 2;
      sBuf.copy(buf, pos);
      pos += sBuf.length;
      // position
      buf.writeBigInt64BE(0n, pos);
      pos += 8;

      const base64 = buf.subarray(0, pos).toString("base64");
      const decoded = decodeTrackInfo(base64);

      expect(decoded.title).toBe("V3 Title");
      expect(decoded.author).toBe("V3 Author");
      expect(decoded.artworkUrl).toBe("https://example.com/art.jpg");
      expect(decoded.isrc).toBe("US1234567890");
    });

    it("MiddlewareRegistry intercepts playback in kumo.play()", async () => {
      const k = new YuKumo({ nodes: nodeConfigs });
      const n = k.nodes.get("main")!;
      silenceWs(n);
      const player = await k.createPlayer({ guildId: "mid-guild", voiceChannelId: "vc-1" });
      player.setVoiceState({ sessionId: "s1", channelId: "vc-1", endpoint: "wss://ep", token: "tok" });

      let intercepted = false;
      k.middleware.useBeforeTrackStart((_guildId, _track) => {
        intercepted = true;
        return false; // reject
      });

      await k.play("mid-guild", makeTrack("blocked-track"));
      expect(intercepted).toBe(true);
      expect(player.status).toBe("idle");
    });

    it("PrometheusExporter reports actual connected nodes count", () => {
      const k = new YuKumo({ nodes: nodeConfigs });
      const exporter = new PrometheusExporter(k);

      // Main node starts disconnected in mock test
      const rendered = exporter.renderMetrics();
      expect(rendered).toContain("yukumo_connected_nodes 0");
    });
  });
});
