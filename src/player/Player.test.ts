import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Player } from "./Player.ts";
import { PlayerManager } from "./PlayerManager.ts";
import { Node } from "../node/Node.ts";
import { VolumeFilter } from "../filters/Filters.ts";
import { EventDispatcher } from "../ws/EventDispatcher.ts";
import { MemoryStorage } from "../storage/MemoryStorage.ts";
import { DestroyReasons } from "../types/constants.ts";
import type { YuKumo } from "../Kumo.ts";
import type { TrackData } from "../types/protocol.ts";

function createMockNode(name = "test-node"): Node {
  const node = new Node(
    {
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name,
    },
    "123456",
  );

  Object.defineProperty(node.ws, "eventDispatcher", {
    value: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    configurable: true,
  });

  Object.defineProperty(node.rest, "sessionId", {
    value: "test-session",
    writable: true,
    configurable: true,
  });

  node.rest.updatePlayer = vi.fn();
  node.rest.destroyPlayer = vi.fn();

  return node;
}

function createPlayer(node?: Node): Player {
  const kumoMock = {} as any;
  return new Player({
    guildId: "guild-1",
    node: node ?? createMockNode(),
    voiceChannelId: "channel-1",
    textChannelId: "text-1",
    kumo: kumoMock,
  });
}

const mockTrack: TrackData = {
  encoded: "AAA",
  info: {
    identifier: "test-id",
    isSeekable: true,
    author: "Test Author",
    length: 100000,
    isStream: false,
    position: 0,
    title: "Test Track",
    uri: null,
    artworkUrl: null,
    isrc: null,
    sourceName: "youtube",
  },
  pluginInfo: {},
};

describe("Player", () => {
  it("should create with guild and node", () => {
    const player = createPlayer();
    expect(player.guildId).toBe("guild-1");
    expect(player.voiceChannelId).toBe("channel-1");
    expect(player.textChannelId).toBe("text-1");
    expect(player.status).toBe("idle");
  });

  it("should initialize with empty queue and filters", () => {
    const player = createPlayer();
    expect(player.queue.isEmpty).toBe(true);
    expect(player.filters.getAll()).toHaveLength(0);
  });

  it("should return voice state", () => {
    const player = createPlayer();
    player.setVoiceState({
      sessionId: "sess-1",
      channelId: "ch-1",
      endpoint: "endpoint",
      token: "token",
    });

    const state = player.voiceState;
    expect(state.sessionId).toBe("sess-1");
    expect(state.token).toBe("token");
  });

  it("should enqueue and play track", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    player.queue.enqueue(mockTrack);

    await player.play();

    expect(node.rest.updatePlayer).toHaveBeenCalled();
    expect(player.status).toBe("playing");
  });

  it("should throw when playing with empty queue", async () => {
    const player = createPlayer();

    await expect(player.play()).rejects.toThrow("No tracks in queue");
  });

  it("should set volume", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setVolume(50);
    expect(player.volume).toBe(50);
  });

  it("should clamp volume to 0-1000 range", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setVolume(-10);
    expect(player.volume).toBe(0);

    await player.setVolume(2000);
    expect(player.volume).toBe(1000);
  });

  it("should pause", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    player.queue.enqueue(mockTrack);
    await player.play();
    await player.pause();
    expect(player.paused).toBe(true);
    expect(player.status).toBe("paused");
  });

  it("should resume", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    player.queue.enqueue(mockTrack);
    await player.play();
    await player.pause();
    await player.resume();
    expect(player.paused).toBe(false);
    expect(player.status).toBe("playing");
  });

  it("should not fabricate playback status when pausing/resuming while idle", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.resume();
    expect(node.rest.updatePlayer).not.toHaveBeenCalled();
    expect(player.status).toBe("idle");

    await player.pause();
    const callsAfterFirstPause = (node.rest.updatePlayer as ReturnType<typeof vi.fn>).mock.calls.length;
    await player.pause();
    expect((node.rest.updatePlayer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterFirstPause,
    );
    expect(player.paused).toBe(true);
    expect(player.status).toBe("idle");
  });

  it("should stop", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    player.queue.enqueue(mockTrack);
    await player.play();
    await player.stop();

    expect(player.status).toBe("idle");
    expect(player.position).toBe(0);
  });

  it("should seek", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.seek(30000);
    expect(node.rest.updatePlayer).toHaveBeenCalledWith("test-session", "guild-1", { position: 30000 });
  });

  it("should set voice channel", async () => {
    const player = createPlayer();
    await player.setVoiceChannel("channel-2", { selfDeaf: true });
    expect(player.voiceChannelId).toBe("channel-2");
  });

  it("should set node", async () => {
    const player = createPlayer();
    const newNode = createMockNode("new-node");
    await player.setNode(newNode);
    expect(player.node.id).toBe("new-node");
  });

  it("should destroy and cleanup", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    player.queue.enqueue(mockTrack);
    player.filters.add(new VolumeFilter(0.5));

    await player.destroy();

    expect(player.destroyed).toBe(true);
    expect(player.status).toBe("destroyed");
    expect(player.queue.isEmpty).toBe(true);
    expect(player.filters.getAll()).toHaveLength(0);
    expect(node.rest.destroyPlayer).toHaveBeenCalled();
  });

  it("should track position via playerUpdate", () => {
    const player = createPlayer();
    const node = player.node;

    const onCalls = (node.ws.eventDispatcher.on as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, unknown]
    >;
    const playerUpdateCall = onCalls.find((c) => c[0] === "playerUpdate");

    if (playerUpdateCall != null) {
      const handler = playerUpdateCall[1] as (guildId: string, state: { position: number }) => void;
      handler("guild-1", { position: 50000 });
    }

    expect(player.position).toBe(50000);
  });

  it("should set and clear filters in real time", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    player.filters.setBassBoost("high");
    await player.setFilters();
    expect(node.rest.updatePlayer).toHaveBeenCalled();

    await player.clearFilters();
    expect(player.filters.getAll()).toHaveLength(0);
  });

  it("should configure autoplay and fetcher", () => {
    const player = createPlayer();
    const mockFetcher = vi.fn();
    player.setAutoplay(true, mockFetcher);

    expect(player.autoplay).toBe(true);
    expect(player.autoplayFetcher).toBe(mockFetcher);
  });

  it("should throw on operations when destroyed", async () => {
    const player = createPlayer();
    await player.destroy();

    await expect(player.play()).rejects.toThrow("Player is destroyed");
    await expect(player.stop()).rejects.toThrow("Player is destroyed");
    await expect(player.pause()).rejects.toThrow("Player is destroyed");
    await expect(player.setVolume(50)).rejects.toThrow("Player is destroyed");
  });
});

describe("PlayerManager", () => {
  let manager: PlayerManager;

  beforeEach(() => {
    const kumoMock = {} as any;
    manager = new PlayerManager(kumoMock);
  });

  it("should create a player", () => {
    const player = manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });

    expect(player.guildId).toBe("guild-1");
    expect(manager.size()).toBe(1);
  });

  it("should return existing player for same guild", () => {
    const player1 = manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });
    const player2 = manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });

    expect(player1).toBe(player2);
    expect(manager.size()).toBe(1);
  });

  it("should get a player by guild id", () => {
    const player = manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });

    expect(manager.get("guild-1")).toBe(player);
    expect(manager.has("guild-1")).toBe(true);
    expect(manager.has("noop")).toBe(false);
  });

  it("should destroy a player", async () => {
    manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });

    const destroyed = await manager.destroy("guild-1");
    expect(destroyed).toBe(true);
    expect(manager.size()).toBe(0);
  });

  it("should return false destroying non-existent player", async () => {
    expect(await manager.destroy("noop")).toBe(false);
  });

  it("should get all players", () => {
    manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });
    manager.create({
      guildId: "guild-2",
      node: createMockNode("node-2"),
      voiceChannelId: "channel-2",
    });

    expect(manager.getAll()).toHaveLength(2);
  });

  it("should get players by node", () => {
    const node = createMockNode("shared-node");
    manager.create({
      guildId: "guild-1",
      node,
      voiceChannelId: "channel-1",
    });
    manager.create({
      guildId: "guild-2",
      node: createMockNode("other-node"),
      voiceChannelId: "channel-2",
    });

    const nodePlayers = manager.getByNode("shared-node");
    expect(nodePlayers).toHaveLength(1);
    expect(nodePlayers[0]?.guildId).toBe("guild-1");
  });

  it("should destroy all players", async () => {
    manager.create({
      guildId: "guild-1",
      node: createMockNode(),
      voiceChannelId: "channel-1",
    });
    manager.create({
      guildId: "guild-2",
      node: createMockNode(),
      voiceChannelId: "channel-2",
    });

    await manager.destroyAll();
    expect(manager.size()).toBe(0);
  });
});

// Event-driven behavior tests — these use a live EventDispatcher on the mock
// node so trackEnd/trackStart/playerUpdate handlers actually run.

function makeTrack(id: string, length = 30000): TrackData {
  return {
    encoded: `encoded-${id}`,
    info: {
      identifier: id,
      isSeekable: true,
      author: `author-${id}`,
      length,
      isStream: false,
      position: 0,
      title: `title-${id}`,
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "test",
    },
    pluginInfo: {},
  };
}

function makeLiveNode(id = "live-node") {
  return {
    id,
    playerCount: 0,
    state: "connected",
    ping: 42,
    ws: { eventDispatcher: new EventDispatcher() },
    rest: {
      sessionId: "lava-session" as string | null,
      updatePlayer: vi.fn().mockResolvedValue({}),
      destroyPlayer: vi.fn().mockResolvedValue(undefined),
      loadTracks: vi.fn().mockResolvedValue({ loadType: "empty", data: null }),
      setSponsorBlockCategories: vi.fn().mockResolvedValue(undefined),
      getSponsorBlockCategories: vi.fn().mockResolvedValue(["sponsor"]),
      deleteSponsorBlockCategories: vi.fn().mockResolvedValue(undefined),
      subscribeLyrics: vi.fn().mockResolvedValue(undefined),
      unsubscribeLyrics: vi.fn().mockResolvedValue(undefined),
      getCurrentLyrics: vi.fn().mockResolvedValue({ text: "la" }),
    },
  };
}

function makeMockKumo() {
  const kumo = {
    events: new EventDispatcher(),
    voice: { getVoiceState: () => null },
    sendGatewayPayload: vi.fn(),
    storage: new MemoryStorage(),
  } as unknown as YuKumo;
  (kumo as { players: PlayerManager }).players = new PlayerManager(kumo);
  return kumo;
}

const VOICE_STATE = {
  sessionId: "voice-session",
  channelId: "vc-1",
  endpoint: "voice.discord.gg",
  token: "voice-token",
};

/** REST calls that actually start a track (payload contains a non-null encoded track) */
function trackPlays(node: ReturnType<typeof makeLiveNode>): string[] {
  return node.rest.updatePlayer.mock.calls
    .filter((c) => c[2]?.track?.encoded != null)
    .map((c) => c[2].track.encoded as string);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("Player track-end handling and lifecycle", () => {
  let node: ReturnType<typeof makeLiveNode>;
  let kumo: YuKumo;

  beforeEach(() => {
    node = makeLiveNode();
    kumo = makeMockKumo();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createLivePlayer(guildId = "guild-1") {
    const player = kumo.players.create({
      guildId,
      node: node as unknown as Node,
      voiceChannelId: "vc-1",
    });
    player.setVoiceState(VOICE_STATE);
    return player;
  }

  it("advances to the next track on finished trackEnd", async () => {
    const player = createLivePlayer();
    player.queue.enqueue(makeTrack("a")).enqueue(makeTrack("b"));
    await player.play();

    node.ws.eventDispatcher.emit("trackEnd", "guild-1", makeTrack("a"), "finished");
    await flush();

    expect(trackPlays(node)).toEqual(["encoded-a", "encoded-b"]);
  });

  it("serializes overlapping track-end handling (no double advance)", async () => {
    const player = createLivePlayer();
    player.queue.enqueue(makeTrack("a")).enqueue(makeTrack("b")).enqueue(makeTrack("c"));
    await player.play();

    node.ws.eventDispatcher.emit("trackEnd", "guild-1", makeTrack("a"), "finished");
    node.ws.eventDispatcher.emit("trackEnd", "guild-1", makeTrack("b"), "finished");
    await flush();

    expect(trackPlays(node)).toEqual(["encoded-a", "encoded-b", "encoded-c"]);
  });

  it("skip() with nothing playing emits queueEnd and does not throw when autoplay is on", async () => {
    const player = createLivePlayer();
    player.setAutoplay(true);
    const queueEnd = vi.fn();
    player.on("queueEnd", queueEnd);

    const result = await player.skip();

    expect(result).toBeNull();
    expect(queueEnd).toHaveBeenCalledWith("guild-1");
  });

  it("skip() advances past repeat-track mode", async () => {
    const player = createLivePlayer();
    player.setLoop("track");
    player.queue.enqueue(makeTrack("a")).enqueue(makeTrack("b"));
    await player.play();

    const next = await player.skip();
    expect(next?.encoded).toBe("encoded-b");
    expect(trackPlays(node)).toEqual(["encoded-a", "encoded-b"]);
  });

  it("setVolume remembers the value while the node session is unavailable", async () => {
    const player = createLivePlayer();
    node.rest.sessionId = null;

    await player.setVolume(50);
    expect(player.volume).toBe(50);
    expect(node.rest.updatePlayer).not.toHaveBeenCalled();

    node.rest.sessionId = "lava-session";
    player.queue.enqueue(makeTrack("a"));
    await player.play();
    const playCall = node.rest.updatePlayer.mock.calls.find((c) => c[2]?.track != null);
    expect(playCall?.[2].volume).toBe(50);
  });

  it("seek() clamps to [0, track length]", async () => {
    const player = createLivePlayer();
    player.queue.enqueue(makeTrack("a", 30000));
    await player.play();

    await player.seek(-500);
    expect(node.rest.updatePlayer.mock.calls.at(-1)?.[2].position).toBe(0);

    await player.seek(99999999);
    expect(node.rest.updatePlayer.mock.calls.at(-1)?.[2].position).toBe(30000);
  });

  it("interpolates position between playerUpdates and freezes it while paused", async () => {
    vi.useFakeTimers();
    const player = createLivePlayer();
    player.queue.enqueue(makeTrack("a", 60000));
    await player.play();
    node.ws.eventDispatcher.emit("trackStart", "guild-1", makeTrack("a"));

    node.ws.eventDispatcher.emit("playerUpdate", "guild-1", {
      time: 0,
      position: 1000,
      connected: true,
      ping: 1,
    });
    vi.advanceTimersByTime(2000);
    expect(player.position).toBe(3000);

    await player.pause();
    const frozen = player.position;
    vi.advanceTimersByTime(5000);
    expect(player.position).toBe(frozen);
  });

  it("runs autoplay with a custom fetcher when the queue drains", async () => {
    const player = createLivePlayer();
    const auto = makeTrack("auto");
    const fetcher = vi.fn().mockResolvedValue(auto);
    player.setAutoplay(true, fetcher);
    const added = vi.fn();
    player.on("autoplayTrackAdded", added);

    player.queue.enqueue(makeTrack("a"));
    await player.play();
    node.ws.eventDispatcher.emit("trackEnd", "guild-1", makeTrack("a"), "finished");
    await flush();

    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ encoded: "encoded-a" }));
    expect(added).toHaveBeenCalledWith("guild-1", auto);
    expect(trackPlays(node)).toEqual(["encoded-a", "encoded-auto"]);
  });

  it("destroy() unregisters from the manager, adjusts playerCount, and emits playerDestroy once", async () => {
    const player = createLivePlayer();
    expect(node.playerCount).toBe(1);
    const destroyed = vi.fn();
    kumo.events.on("playerDestroy", destroyed);

    await player.destroy();
    await player.destroy(); // double destroy is a no-op

    expect(kumo.players.has("guild-1")).toBe(false);
    expect(node.playerCount).toBe(0);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(node.rest.destroyPlayer).toHaveBeenCalledWith("lava-session", "guild-1");
  });

  it("empty-VC auto-disconnect destroys AND unregisters the player", async () => {
    vi.useFakeTimers();
    const player = createLivePlayer();
    player.emptyVcTimeoutMs = 1000;
    const autoDisconnected = vi.fn();
    player.on("playerAutoDisconnected", autoDisconnected);

    player.setVcMemberCount(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(autoDisconnected).toHaveBeenCalledWith("guild-1");
    expect(player.destroyed).toBe(true);
    expect(kumo.players.has("guild-1")).toBe(false);
  });

  it("manager replaces a destroyed player instead of returning the husk", async () => {
    const player = createLivePlayer();
    await player.destroy();

    const fresh = createLivePlayer();
    expect(fresh).not.toBe(player);
    expect(fresh.destroyed).toBe(false);
    expect(kumo.players.get("guild-1")).toBe(fresh);
  });

  it("passes endTime/noReplace/paused/volume play options to the node", async () => {
    const player = createLivePlayer();
    await player.play(makeTrack("a"), { endTime: 5000, noReplace: true, paused: true, volume: 80 });

    const call = node.rest.updatePlayer.mock.calls.find((c) => c[2]?.track != null);
    expect(call?.[2].endTime).toBe(5000);
    expect(call?.[2].paused).toBe(true);
    expect(call?.[2].volume).toBe(80);
    expect(call?.[3]).toBe(true); // noReplace
    expect(player.paused).toBe(true);
    expect(player.volume).toBe(80);
  });

  it("destroys the player with the right reason when maxErrorsPerTime is exceeded", async () => {
    const player = createLivePlayer();
    player.maxErrorsPerTime = { threshold: 35000, maxAmount: 2 };
    const destroyed = vi.fn();
    kumo.events.on("playerDestroy", destroyed);

    for (let i = 0; i < 3; i++) {
      node.ws.eventDispatcher.emit("trackException", "guild-1", makeTrack("a"), { message: "boom" });
    }
    await flush();

    expect(player.destroyed).toBe(true);
    expect(destroyed).toHaveBeenCalledWith("guild-1", DestroyReasons.TrackErrorMaxTracksErroredPerTime);
  });

  it("destroys the player queueEmptyDestroyMs after the queue ends", async () => {
    vi.useFakeTimers();
    const player = createLivePlayer();
    player.queueEmptyDestroyMs = 500;
    player.queue.enqueue(makeTrack("a"));
    await player.play();

    node.ws.eventDispatcher.emit("trackEnd", "guild-1", makeTrack("a"), "finished");
    await vi.advanceTimersByTimeAsync(600);

    expect(player.destroyed).toBe(true);
    expect(kumo.players.has("guild-1")).toBe(false);
  });

  it("blocks autoplay after an error end when the track played under minAutoPlayMs", async () => {
    const player = createLivePlayer();
    player.minAutoPlayMs = 10000;
    const fetcher = vi.fn().mockResolvedValue(makeTrack("auto"));
    player.setAutoplay(true, fetcher);
    const queueEnd = vi.fn();
    player.on("queueEnd", queueEnd);

    player.queue.enqueue(makeTrack("a"));
    await player.play();
    node.ws.eventDispatcher.emit("trackStart", "guild-1", makeTrack("a"));
    node.ws.eventDispatcher.emit("trackEnd", "guild-1", makeTrack("a"), "loadFailed");
    await flush();

    expect(fetcher).not.toHaveBeenCalled();
    expect(queueEnd).toHaveBeenCalledWith("guild-1");
  });

  it("persists the queue and restores it on a fresh player", async () => {
    const player = createLivePlayer();
    player.enableQueuePersistence();
    player.queue.enqueue(makeTrack("a")).enqueue(makeTrack("b"));
    await flush(); // microtask-coalesced save

    // Shutdown-style destroy keeps the persisted queue on disk
    await player.destroy(DestroyReasons.DisconnectAllNodes);

    const fresh = createLivePlayer();
    fresh.enableQueuePersistence();
    const restored = await fresh.restoreQueue();
    expect(restored).toBe(true);
    expect(fresh.queue.size).toBe(2);
    expect(fresh.queue.tracksList[0]?.encoded).toBe("encoded-a");
  });

  it("deletes the persisted queue on a normal destroy", async () => {
    const player = createLivePlayer();
    player.enableQueuePersistence();
    player.queue.enqueue(makeTrack("a"));
    await flush();

    await player.destroy(); // ManualDestroy
    await flush();

    const fresh = createLivePlayer();
    fresh.enableQueuePersistence();
    expect(await fresh.restoreQueue()).toBe(false);
  });

  it("forwards guild-scoped plugin events to player.events", async () => {
    const player = createLivePlayer();
    const onLine = vi.fn();
    const onSegments = vi.fn();
    player.on("lyricsLine", onLine);
    player.on("segmentsLoaded", onSegments);

    node.ws.eventDispatcher.emit("lyricsLine", "guild-1", { line: "hello" });
    node.ws.eventDispatcher.emit("segmentsLoaded", "guild-1", [{ category: "sponsor" }]);
    node.ws.eventDispatcher.emit("lyricsLine", "other-guild", { line: "nope" });

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith("guild-1", { line: "hello" });
    expect(onSegments).toHaveBeenCalledWith("guild-1", [{ category: "sponsor" }]);
  });

  it("calls SponsorBlock and lyrics endpoints with session and guild", async () => {
    const player = createLivePlayer();

    await player.setSponsorBlock(["sponsor", "intro"]);
    expect(node.rest.setSponsorBlockCategories).toHaveBeenCalledWith("lava-session", "guild-1", [
      "sponsor",
      "intro",
    ]);

    await expect(player.getSponsorBlock()).resolves.toEqual(["sponsor"]);
    await player.deleteSponsorBlock();
    expect(node.rest.deleteSponsorBlockCategories).toHaveBeenCalledWith("lava-session", "guild-1");

    await player.subscribeLyrics(true);
    expect(node.rest.subscribeLyrics).toHaveBeenCalledWith("lava-session", "guild-1", true);
    await player.unsubscribeLyrics();
    expect(node.rest.unsubscribeLyrics).toHaveBeenCalledWith("lava-session", "guild-1");
    await expect(player.getCurrentLyrics()).resolves.toEqual({ text: "la" });
  });

  it("exposes ping and a full toJSON snapshot", async () => {
    const player = createLivePlayer();
    player.queue.enqueue(makeTrack("a"));
    await player.play();
    node.ws.eventDispatcher.emit("playerUpdate", "guild-1", {
      time: 0,
      position: 1234,
      connected: true,
      ping: 17,
    });

    expect(player.ping).toEqual({ ws: 42, lavalink: 17 });

    const json = player.toJSON();
    expect(json.guildId).toBe("guild-1");
    expect(json.status).toBe("playing");
    expect(json.nodeId).toBe("live-node");
    expect(json.queue.tracks[0]?.encoded).toBe("encoded-a");
    expect(json.voiceState.token).toBe("voice-token");
  });
});
