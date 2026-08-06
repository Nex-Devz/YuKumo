import { describe, it, expect, vi, beforeEach } from "vitest";
import { YuKumo } from "./Kumo.ts";
import { MemoryStorage } from "./storage/MemoryStorage.ts";
import type { PlayerJson } from "./player/Player.ts";
import type { TrackData } from "./types/protocol.ts";

function makeTrack(id: string, source = "youtube", overrides: Partial<TrackData["info"]> = {}): TrackData {
  return {
    encoded: `enc-${id}`,
    info: {
      identifier: id,
      isSeekable: true,
      author: "Artist",
      length: 200000,
      isStream: false,
      position: 0,
      title: `Track ${id}`,
      uri: `https://example.com/${id}`,
      sourceName: source,
      artworkUrl: null,
      isrc: null,
      ...overrides,
    },
    pluginInfo: {},
    userData: {},
  } as TrackData;
}

function makeKumo(storage: MemoryStorage, extra: Record<string, unknown> = {}): YuKumo {
  return new YuKumo({
    nodes: [{ host: "localhost", port: 2333, password: "pass", name: "main" }],
    userId: "bot123",
    storageAdapter: storage,
    resuming: { enabled: true, timeout: 120 },
    ...extra,
  } as never);
}

/** Wires a fake connected node/session onto the manager's registered node */
function fakeNodeReady(kumo: YuKumo, opts: { resumed?: boolean } = {}): void {
  const node = kumo.getNode("main")!;
  Object.defineProperty(node.ws, "state", { get: () => "connected", configurable: true });
  Object.defineProperty(node.ws, "sessionId", { get: () => "sess-1", configurable: true });
  Object.defineProperty(node.ws, "resumed", { get: () => opts.resumed ?? false, configurable: true });
  node.rest.sessionId = "sess-1";
}

describe("session resuming config", () => {
  it("propagates resuming + resumeTimeout to node configs", () => {
    const kumo = makeKumo(new MemoryStorage());
    const node = kumo.getNode("main")!;
    expect(node.config.resuming).toBe(true);
    expect(node.config.resumeTimeout).toBe(120);
  });

  it("respects per-node overrides", () => {
    const kumo = new YuKumo({
      nodes: [
        { host: "localhost", port: 2333, password: "p", name: "main", resuming: false, resumeTimeout: 5 },
      ],
      userId: "bot",
      resuming: { enabled: true, timeout: 120 },
    } as never);
    const node = kumo.getNode("main")!;
    expect(node.config.resuming).toBe(false);
    expect(node.config.resumeTimeout).toBe(5);
  });

  it("seeds persisted session IDs into the WS client before connect", async () => {
    const storage = new MemoryStorage();
    await storage.set("yukumo:session:main", "old-session-abc");
    const kumo = makeKumo(storage);
    const node = kumo.getNode("main")!;
    const spy = vi.spyOn(node.ws, "setSessionId");
    vi.spyOn(node.ws, "connect").mockResolvedValue(undefined);
    await kumo.init();
    expect(spy).toHaveBeenCalledWith("old-session-abc");
  });

  it("WS setSessionId makes Session-Id available pre-connect", () => {
    const kumo = makeKumo(new MemoryStorage());
    const node = kumo.getNode("main")!;
    node.ws.setSessionId("persisted-1");
    expect(node.ws.sessionId).toBe("persisted-1");
  });
});

describe("player state persistence + restore", () => {
  let storage: MemoryStorage;
  let kumo: YuKumo;

  beforeEach(() => {
    storage = new MemoryStorage();
    kumo = makeKumo(storage);
    fakeNodeReady(kumo);
  });

  it("persists a snapshot and index on player create", async () => {
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc1" });
    player.queue.enqueue(makeTrack("t1") as never);
    await player.saveState();
    // wait for the fire-and-forget index write
    await new Promise((r) => setTimeout(r, 0));

    const snapshot = (await storage.get("yukumo:player:g1")) as PlayerJson;
    expect(snapshot.guildId).toBe("g1");
    expect(snapshot.queue.tracks).toHaveLength(1);
    const index = (await storage.get("yukumo:players:index")) as string[];
    expect(index).toContain("g1");
  });

  it("restorePlayers rebuilds players and replays at saved position", async () => {
    const snapshot: PlayerJson = {
      guildId: "g2",
      voiceChannelId: "vc2",
      textChannelId: "tc2",
      status: "playing",
      paused: false,
      volume: 73,
      position: 42000,
      repeatMode: "queue",
      autoplay: true,
      stayInVc: true,
      nodeId: "main",
      queue: {
        tracks: [makeTrack("t9")],
        history: [],
        currentIndex: 0,
        repeatMode: "queue",
      } as never,
      filters: {},
      voiceState: { sessionId: null, channelId: null, endpoint: null, token: null },
    };
    await storage.set("yukumo:players:index", ["g2"]);
    await storage.set("yukumo:player:g2", snapshot);

    const node = kumo.getNode("main")!;
    const updateSpy = vi.spyOn(node.rest, "updatePlayer").mockResolvedValue({} as never);
    const restoredEvents: Array<[string, boolean]> = [];
    kumo.on("playerRestored", (guildId, resumedLive) => restoredEvents.push([guildId, resumedLive]));

    // playTrack awaits voice readiness — feed credentials via the tracker
    const restorePromise = kumo.restorePlayers();
    await new Promise((r) => setTimeout(r, 0));
    const player = kumo.getPlayer("g2");
    expect(player).toBeDefined();
    player!.setVoiceState({ sessionId: "vs", channelId: "vc2", endpoint: "ep", token: "tok" });
    const count = await restorePromise;

    expect(count).toBe(1);
    expect(player!.volume).toBe(73);
    expect(player!.queue.repeatMode).toBe("queue");
    expect(player!.autoplay).toBe(true);
    expect(player!.stayInVc).toBe(true);
    expect(restoredEvents).toEqual([["g2", false]]);
    const playCall = updateSpy.mock.calls.find((c) => (c[2] as { track?: unknown }).track != null);
    expect(playCall).toBeDefined();
    expect((playCall![2] as { position?: number }).position).toBe(42000);
  });

  it("adopts a live player without re-sending play when the session resumed", async () => {
    const snapshot: PlayerJson = {
      guildId: "g3",
      voiceChannelId: "vc3",
      textChannelId: null,
      status: "playing",
      paused: false,
      volume: 100,
      position: 1000,
      repeatMode: "none",
      autoplay: false,
      stayInVc: false,
      nodeId: "main",
      queue: {
        tracks: [makeTrack("live1")],
        history: [],
        currentIndex: 0,
        repeatMode: "none",
      } as never,
      filters: {},
      voiceState: { sessionId: null, channelId: null, endpoint: null, token: null },
    };
    await storage.set("yukumo:players:index", ["g3"]);
    await storage.set("yukumo:player:g3", snapshot);

    fakeNodeReady(kumo, { resumed: true });
    const node = kumo.getNode("main")!;
    vi.spyOn(node.rest, "getPlayer").mockResolvedValue({
      guildId: "g3",
      track: makeTrack("live1"),
      volume: 100,
      paused: false,
      state: { time: 0, position: 55000, connected: true, ping: 10 },
      voice: {},
      filters: {},
    } as never);
    const updateSpy = vi.spyOn(node.rest, "updatePlayer").mockResolvedValue({} as never);

    const count = await kumo.restorePlayers();
    expect(count).toBe(1);
    const player = kumo.getPlayer("g3")!;
    expect(player.status).toBe("playing");
    expect(player.position).toBeGreaterThanOrEqual(55000);
    // no play request was sent — audio never stopped
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("source-aware autoplay", () => {
  let kumo: YuKumo;

  beforeEach(() => {
    kumo = makeKumo(new MemoryStorage());
    fakeNodeReady(kumo);
  });

  async function playerWith(track: TrackData) {
    const player = await kumo.createPlayer({ guildId: "ap", voiceChannelId: "vc" });
    player.queue.enqueue(track as never);
    player.queue.start();
    return player;
  }

  it("uses the YouTube RD mix for youtube tracks", async () => {
    const player = await playerWith(makeTrack("yt1", "youtube"));
    const node = kumo.getNode("main")!;
    const load = vi.spyOn(node.rest, "loadTracks").mockResolvedValue({
      loadType: "playlist",
      data: { info: { name: "mix", selectedTrack: 0 }, pluginInfo: {}, tracks: [makeTrack("yt2")] },
    } as never);
    const picked = await player.resolveAutoplayTrack(makeTrack("yt1", "youtube") as never);
    expect(load).toHaveBeenCalledWith("https://www.youtube.com/watch?v=yt1&list=RDyt1");
    expect(picked?.info?.identifier).toBe("yt2");
  });

  it.each([
    ["spotify", "sp1", "sprec:seed_tracks=sp1"],
    ["deezer", "dz1", "dzrec:dz1"],
    ["yandexmusic", "ym1", "ymrec:ym1"],
  ])("uses the %s recommendation prefix", async (source, id, expected) => {
    const player = await playerWith(makeTrack(id, source));
    const node = kumo.getNode("main")!;
    const load = vi.spyOn(node.rest, "loadTracks").mockResolvedValue({
      loadType: "search",
      data: [makeTrack(`${id}-rec`)],
    } as never);
    const picked = await player.resolveAutoplayTrack(makeTrack(id, source) as never);
    expect(load).toHaveBeenCalledWith(expected);
    expect(picked?.info?.identifier).toBe(`${id}-rec`);
  });

  it("falls back to ytsearch when the recommendation prefix fails", async () => {
    const player = await playerWith(makeTrack("sp2", "spotify"));
    const node = kumo.getNode("main")!;
    const load = vi
      .spyOn(node.rest, "loadTracks")
      .mockRejectedValueOnce(new Error("sprec unsupported"))
      .mockResolvedValueOnce({ loadType: "search", data: [makeTrack("fb1")] } as never);
    const picked = await player.resolveAutoplayTrack(makeTrack("sp2", "spotify") as never);
    expect(load).toHaveBeenLastCalledWith("ytsearch:Artist Track sp2");
    expect(picked?.info?.identifier).toBe("fb1");
  });

  it("skips recently played tracks", async () => {
    const player = await playerWith(makeTrack("cur", "youtube"));
    const node = kumo.getNode("main")!;
    vi.spyOn(node.rest, "loadTracks").mockResolvedValue({
      loadType: "search",
      data: [makeTrack("cur"), makeTrack("fresh")],
    } as never);
    const picked = await player.resolveAutoplayTrack(makeTrack("cur", "youtube") as never);
    expect(picked?.info?.identifier).toBe("fresh");
  });

  it("playerDefaults.autoplay enables autoplay on created players", async () => {
    const k2 = makeKumo(new MemoryStorage(), { playerDefaults: { autoplay: true } });
    fakeNodeReady(k2);
    const player = await k2.createPlayer({ guildId: "auto", voiceChannelId: "vc" });
    expect(player.autoplay).toBe(true);
  });
});

describe("NodeLink support", () => {
  it("isNodeLink honors config and gates NodeLink-only player APIs", async () => {
    const kumo = new YuKumo({
      nodes: [{ host: "localhost", port: 2333, password: "p", name: "main", isNodeLink: true }],
      userId: "bot",
    } as never);
    fakeNodeReady(kumo);
    const node = kumo.getNode("main")!;
    expect(node.isNodeLink).toBe(true);

    const player = await kumo.createPlayer({ guildId: "nl", voiceChannelId: "vc" });
    expect(player.isOnNodeLink).toBe(true);
    const update = vi.spyOn(node.rest, "updatePlayer").mockResolvedValue({} as never);
    await player.setGaplessNext(makeTrack("next1") as never);
    expect(update).toHaveBeenCalledWith("sess-1", "nl", {
      nextTrack: { encoded: "enc-next1" },
    });
    await player.setFading({ trackEnd: { duration: 3000, curve: "s-curve" } });
    expect(update).toHaveBeenLastCalledWith("sess-1", "nl", {
      fading: { trackEnd: { duration: 3000, curve: "s-curve" } },
    });
  });

  it("NodeLink-only APIs throw on a regular Lavalink node", async () => {
    const kumo = makeKumo(new MemoryStorage());
    fakeNodeReady(kumo);
    const player = await kumo.createPlayer({ guildId: "ll", voiceChannelId: "vc" });
    await expect(player.setGaplessNext(makeTrack("x") as never)).rejects.toThrow(
      "requires a NodeLink node",
    );
    expect(() => player.createVoiceReceiver()).toThrow("requires a NodeLink node");
  });

  it("REST exposes NodeLink endpoints with correct paths", async () => {
    const kumo = new YuKumo({
      nodes: [{ host: "localhost", port: 2333, password: "p", name: "main", isNodeLink: true }],
      userId: "bot",
    } as never);
    const node = kumo.getNode("main")!;
    node.rest.sessionId = "s1";
    const request = vi
      .spyOn(node.rest as never as { request: (...a: unknown[]) => Promise<unknown> }, "request" as never)
      .mockResolvedValue({} as never);

    await node.rest.loadLyrics("ENC", "en");
    expect(request).toHaveBeenCalledWith("GET", "/loadlyrics", undefined, {
      encodedTrack: "ENC",
      lang: "en",
    });
    await node.rest.loadChapters("ENC");
    expect(request).toHaveBeenCalledWith("GET", "/loadchapters", undefined, { encodedTrack: "ENC" });
    await node.rest.addMixLayer("s1", "g1", { type: "tts" });
    expect(request).toHaveBeenCalledWith("POST", "/sessions/s1/players/g1/mix", { type: "tts" });
    await node.rest.removeMixLayer("s1", "g1", "m1");
    expect(request).toHaveBeenCalledWith("DELETE", "/sessions/s1/players/g1/mix/m1");
  });

  it("getLyrics routes to /loadlyrics on NodeLink nodes", async () => {
    const kumo = new YuKumo({
      nodes: [{ host: "localhost", port: 2333, password: "p", name: "main", isNodeLink: true }],
      userId: "bot",
    } as never);
    fakeNodeReady(kumo);
    const node = kumo.getNode("main")!;
    const loadLyrics = vi.spyOn(node.rest, "loadLyrics").mockResolvedValue({ found: true });
    const res = await kumo.getLyrics("ENC");
    expect(loadLyrics).toHaveBeenCalledWith("ENC");
    expect(res).toEqual({ found: true });
  });
});
