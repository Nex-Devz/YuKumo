import { describe, it, expect, vi } from "vitest";
import { Player } from "./Player.ts";
import { Node } from "../node/Node.ts";
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

describe("Player state getters", () => {
  it("isPlaying / isPaused track playback state", () => {
    const player = createPlayer();
    expect(player.isPlaying).toBe(false);
    expect(player.isPaused).toBe(false);

    (player as any)._status = "playing";
    expect(player.isPlaying).toBe(true);

    (player as any)._paused = true;
    expect(player.isPaused).toBe(true);
    expect(player.isPlaying).toBe(false);
  });

  it("isConnected follows voice credentials + node state", () => {
    const node = createMockNode();
    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
    const player = createPlayer(node);
    expect(player.isConnected).toBe(false);

    player.updateVoiceState({ sessionId: "sess", endpoint: "ep", token: "tok", channelId: "ch" });
    expect(player.isConnected).toBe(true);
  });

  it("isDestroyed tracks the destroyed flag", () => {
    const player = createPlayer();
    expect(player.isDestroyed).toBe(false);
    (player as any)._destroyed = true;
    expect(player.isDestroyed).toBe(true);
  });

  it("isAutoplay mirrors autoplay state", () => {
    const player = createPlayer();
    expect(player.isAutoplay).toBe(false);
    player.setAutoplay(true);
    expect(player.isAutoplay).toBe(true);
  });
});

describe("Repeat mode aliases", () => {
  it("setTrackRepeat enables track repeat and keeps queue repeat off", () => {
    const player = createPlayer();
    player.setTrackRepeat(true);
    expect(player.queue.repeatMode).toBe("track");
    expect(player.trackRepeat).toBe(true);
    expect(player.queueRepeat).toBe(false);
  });

  it("setQueueRepeat enables queue repeat and keeps track repeat off", () => {
    const player = createPlayer();
    player.setQueueRepeat(true);
    expect(player.queue.repeatMode).toBe("queue");
    expect(player.queueRepeat).toBe(true);
    expect(player.trackRepeat).toBe(false);
  });

  it("disabling one repeat mode preserves the other", () => {
    const player = createPlayer();
    player.setLoop("queue");
    player.trackRepeat = false; // queue is untouched
    expect(player.queue.repeatMode).toBe("queue");

    player.trackRepeat = true; // switches to track repeat
    expect(player.queue.repeatMode).toBe("track");

    player.queueRepeat = false; // track is untouched
    expect(player.queue.repeatMode).toBe("track");
  });
});

describe("Individual filter setters", () => {
  it("setEqualizer replaces the equalizer filter and syncs to the node", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setEqualizer([{ band: 0, gain: 0.5 }]);

    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({
        filters: expect.objectContaining({ equalizer: [{ band: 0, gain: 0.5 }] }),
      }),
    );
  });

  it("setTimescale adds a timescale filter", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setTimescale({ speed: 1.25, pitch: 1.25 });

    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({ filters: expect.objectContaining({ timescale: expect.any(Object) }) }),
    );
    expect(player.filters.has("timescale")).toBe(true);
  });

  it("setVolumeFilter replaces the volume filter", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setVolumeFilter(0.5);
    expect(player.filters.get("volume")).toBeDefined();
    expect(node.rest.updatePlayer).toHaveBeenCalled();
  });

  it("calling the same setter twice replaces instead of stacking", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setEqualizer([{ band: 0, gain: 0.5 }]);
    await player.setEqualizer([{ band: 5, gain: -0.2 }]);

    const filters = (node.rest.updatePlayer as any).mock.calls.at(-1)[2].filters;
    expect(filters.equalizer).toEqual([{ band: 5, gain: -0.2 }]);
  });
});

describe("setFilters with raw FiltersObject", () => {
  it("applies a raw lavalink filters object and syncs it", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setFilters({ volume: 0.5, equalizer: [{ band: 0, gain: 1 }] });

    expect(player.filters.has("volume")).toBe(true);
    expect(player.filters.has("equalizer")).toBe(true);
    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({
        filters: expect.objectContaining({ volume: 0.5, equalizer: [{ band: 0, gain: 1 }] }),
      }),
    );
  });

  it("still accepts a FilterChain instance", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setNightcore(true);
    await player.setFilters(undefined);
    expect(node.rest.updatePlayer).toHaveBeenCalled();
  });
});

describe("player.skipTo", () => {
  it("drives the node to the target track so audio matches the queue cursor", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    player.updateVoiceState({ sessionId: "sess", endpoint: "ep", token: "tok", channelId: "ch" });
    const a = { ...mockTrack, encoded: "A" };
    const b = { ...mockTrack, encoded: "B" };
    const c = { ...mockTrack, encoded: "C" };
    player.queue.enqueue(a).enqueue(b).enqueue(c);
    player.queue.start(); // cursor on A

    const now = await player.skipTo(2); // jump to C

    expect(now?.encoded).toBe("C");
    expect(player.currentTrack?.encoded).toBe("C");
    // The node was told to play C (not left on A)
    const lastCall = (node.rest.updatePlayer as any).mock.calls.at(-1)[2];
    expect(lastCall.track.encoded).toBe("C");
    // Skipped-over track A went to history
    expect(player.queue.historyList.some((t) => (t as TrackData).encoded === "A")).toBe(true);
  });

  it("returns null for an out-of-range index and leaves playback untouched", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    player.queue.enqueue(mockTrack);
    player.queue.start();
    const result = await player.skipTo(99);
    expect(result).toBeNull();
  });
});

describe("player.get(start, end)", () => {
  it("returns the whole queue from start including the current track", () => {
    const player = createPlayer();
    player.queue.enqueue(mockTrack).enqueue(mockTrack).enqueue(mockTrack);
    player.queue.start();

    const all = player.get();
    expect(all).toHaveLength(3);

    const slice = player.get(1, 3);
    expect(slice).toHaveLength(2);
  });

  it("clamps out-of-range bounds", () => {
    const player = createPlayer();
    player.queue.enqueue(mockTrack).enqueue(mockTrack);
    expect(player.get(5)).toHaveLength(0);
    expect(player.get(0, 50)).toHaveLength(2);
    expect(player.get(-3, 1)).toHaveLength(1);
  });
});

describe("cross-family failover drops unsupported filters", () => {
  it("drops NodeLink-only filters when moving onto a Lavalink node", async () => {
    // Start on a NodeLink node with an echo filter applied.
    const nlNode = new Node({ host: "h", port: 1, password: "p", name: "nl", type: "nodelink" }, "123456");
    Object.defineProperty(nlNode.ws, "eventDispatcher", {
      value: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(nlNode.rest, "sessionId", {
      value: "s",
      writable: true,
      configurable: true,
    });
    nlNode.rest.updatePlayer = vi.fn().mockResolvedValue({});

    const player = createPlayer(nlNode);
    await player.setEcho({ delay: 200, feedback: 0.4 });
    expect(player.filters.has("echo")).toBe(true);

    // Move to a plain Lavalink node — echo isn't supported there and must be
    // dropped. createMockNode has no NodeLink flag, so its type is "lavalink".
    const llNode = createMockNode("ll-target");
    await player.setNode(llNode);

    expect(player.filters.has("echo")).toBe(false);
  });
});
