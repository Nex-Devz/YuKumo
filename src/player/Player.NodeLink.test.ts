import { describe, it, expect, vi, beforeEach } from "vitest";
import { Player } from "./Player.ts";
import { Node } from "../node/Node.ts";
import { TrackData } from "../types/protocol.ts";

function createMockNode(name = "test-node", isNodeLink = true): Node {
  const node = new Node(
    {
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name,
      isNodeLink,
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

  node.rest.updatePlayer = vi.fn().mockResolvedValue({});
  node.rest.destroyPlayer = vi.fn().mockResolvedValue(undefined);
  node.rest.setSponsorBlockCategories = vi.fn().mockResolvedValue(undefined);
  node.rest.getSponsorBlockCategories = vi.fn().mockResolvedValue(["sponsor"]);
  node.rest.deleteSponsorBlockCategories = vi.fn().mockResolvedValue(undefined);
  node.rest.updateNodeLinkSponsorBlock = vi.fn().mockResolvedValue({});
  node.rest.getNodeLinkSponsorBlock = vi.fn().mockResolvedValue({
    enabled: true,
    categories: ["sponsor"],
    actionTypes: ["skip"],
    segments: [],
    skipMarginMs: 150,
  });
  node.rest.deleteNodeLinkSponsorBlock = vi.fn().mockResolvedValue(undefined);
  node.rest.setNodeLinkSponsorBlockSegments = vi.fn().mockResolvedValue({});

  return node;
}

function createPlayer(node?: Node): Player {
  return new Player({
    guildId: "guild-1",
    node: node ?? createMockNode(),
    voiceChannelId: "channel-1",
    kumo: {} as never,
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

function payloadOf(node: Node): Record<string, unknown> {
  const calls = (node.rest.updatePlayer as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    string,
    Record<string, unknown>,
  ][];
  return calls[calls.length - 1]?.[2] ?? {};
}

describe("Player (NodeLink)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports isOnNodeLink based on the node", () => {
    expect(createPlayer(createMockNode("nl", true)).isOnNodeLink).toBe(true);
    expect(createPlayer(createMockNode("lava", false)).isOnNodeLink).toBe(false);
  });

  it("routes setSponsorBlock to the NodeLink sponsorblock endpoint", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setSponsorBlock(["sponsor", "intro"]);

    expect(node.rest.updateNodeLinkSponsorBlock).toHaveBeenCalledWith("test-session", "guild-1", {
      categories: ["sponsor", "intro"],
    });
    expect(node.rest.setSponsorBlockCategories).not.toHaveBeenCalled();
  });

  it("reads full sponsorblock state and sets segments", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    const state = await player.getSponsorBlockState();
    expect(state?.categories).toEqual(["sponsor"]);

    await player.setSponsorBlockSegments([{ start: 1, end: 2 }]);
    expect(node.rest.setNodeLinkSponsorBlockSegments).toHaveBeenCalledWith("test-session", "guild-1", [
      { start: 1, end: 2 },
    ]);
  });

  it("uses the Lavalink plugin path when not on NodeLink", async () => {
    const node = createMockNode("lava", false);
    node.rest.setSponsorBlockCategories = vi.fn().mockResolvedValue(undefined);
    const player = createPlayer(node);

    await player.setSponsorBlock(["sponsor"]);

    expect(node.rest.setSponsorBlockCategories).toHaveBeenCalledWith("test-session", "guild-1", ["sponsor"]);
  });

  it("sends expanded fading settings", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setFading({
      enabled: true,
      trackStart: { duration: 500, curve: "linear", type: "volume" },
      ducking: { enabled: true, duration: 300, targetVolume: 0.2 },
    });

    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({
        fading: {
          enabled: true,
          trackStart: { duration: 500, curve: "linear", type: "volume" },
          ducking: { enabled: true, duration: 300, targetVolume: 0.2 },
        },
      }),
    );
  });

  it("toggles loudnessNormalizer and ducking", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setLoudnessNormalizer(true);
    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({ loudnessNormalizer: true }),
    );

    await player.setDucking(true);
    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({ ducking: true }),
    );
  });

  it("configures crossfade", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setCrossfade({ enabled: true, duration: 4000, curve: "sine" });

    expect(node.rest.updatePlayer).toHaveBeenCalledWith(
      "test-session",
      "guild-1",
      expect.objectContaining({ crossfade: { enabled: true, duration: 4000, curve: "sine" } }),
    );
  });

  it("passes audioTrackId and language through playTrack", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.playTrack(mockTrack, { audioTrackId: "2", language: "en" });

    const body = payloadOf(node);
    expect(body.track).toEqual({ encoded: "AAA", audioTrackId: "2", language: "en" });
  });

  it("replays NodeLink flags in playTrack payloads", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setLoudnessNormalizer(true);
    await player.setDucking(true);
    await player.setFading({ enabled: true });

    node.rest.updatePlayer = vi.fn().mockResolvedValue({});

    await player.playTrack(mockTrack);

    const body = payloadOf(node);
    expect(body.loudnessNormalizer).toBe(true);
    expect(body.ducking).toBe(true);
    expect(body.fading).toEqual({ enabled: true });
  });

  it("includes NodeLink flags when resyncing", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    player.setVoiceState({
      sessionId: "vs",
      channelId: "ch",
      endpoint: "wss://x",
      token: "t",
    });
    player.queue.enqueue(mockTrack);
    player.queue.start();
    await player.setLoudnessNormalizer(true);
    await player.setDucking(true);

    await player.resync();

    const body = payloadOf(node);
    expect(body.loudnessNormalizer).toBe(true);
    expect(body.ducking).toBe(true);
  });

  it("adds NodeLink filter setters to the chain and syncs them", async () => {
    const node = createMockNode();
    const player = createPlayer(node);

    await player.setEcho({ delay: 100, feedback: 0.3 });
    await player.setChorus({ rate: 1 });
    await player.setCompressor({ threshold: -30 });
    await player.setPhaser({ stages: 6 });
    await player.setHighPass({ smoothing: 10 });
    await player.setFlanger({ depth: 0.5 });
    await player.setReverb({ mix: 0.4 });
    await player.setSpatial({ depth: 0.2 });
    await player.setPhonograph({ crackle: 0.1 });
    await player.setTesseract({ rotationHz: 0.5 });

    const payload = player.filters.toPayload();
    expect(payload.echo).toEqual({ delay: 100, feedback: 0.3 });
    expect(payload.chorus).toEqual({ rate: 1 });
    expect(payload.compressor).toEqual({ threshold: -30 });
    expect(payload.phaser).toEqual({ stages: 6 });
    expect(payload.highpass).toEqual({ smoothing: 10 });
    expect(payload.flanger).toEqual({ depth: 0.5 });
    expect(payload.reverb).toEqual({ mix: 0.4 });
    expect(payload.spatial).toEqual({ depth: 0.2 });
    expect(payload.phonograph).toEqual({ crackle: 0.1 });
    expect(payload.tesseract).toEqual({ rotationHz: 0.5 });
  });

  it("creates a voice receiver for the guild", () => {
    const node = createMockNode();
    const player = createPlayer(node);
    const receiver = player.createVoiceReceiver();
    expect(receiver.guildId).toBe("guild-1");
  });

  it("exposes NodeLink groups through the rest client", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    node.rest.getGroups = vi.fn().mockResolvedValue([{ id: "g1", guildIds: [], createdAt: 0 }]);
    node.rest.createGroup = vi.fn().mockResolvedValue({ id: "g2", guildIds: [], createdAt: 0 });

    const groups = await player.getGroups();
    expect(groups).toEqual([{ id: "g1", guildIds: [], createdAt: 0 }]);
    expect(node.rest.getGroups).toHaveBeenCalledWith("test-session");

    await player.createGroup({ id: "g2", guildIds: ["12345678901234567"] });
    expect(node.rest.createGroup).toHaveBeenCalledWith("test-session", {
      id: "g2",
      guildIds: ["12345678901234567"],
    });
  });

  it("persists and restores NodeLink flags in the state snapshot", async () => {
    const node = createMockNode();
    const player = createPlayer(node);
    await player.setLoudnessNormalizer(true);
    await player.setFading({ enabled: true, trackEnd: { duration: 1000 } });

    const snapshot = player.toJSON();
    expect(snapshot.loudnessNormalizer).toBe(true);
    expect(snapshot.fading).toEqual({ enabled: true, trackEnd: { duration: 1000 } });

    const restored = createPlayer(createMockNode());
    restored.restoreFromState(snapshot);
    expect(restored.toJSON().loudnessNormalizer).toBe(true);
    expect(restored.toJSON().fading).toEqual({ enabled: true, trackEnd: { duration: 1000 } });
  });
});
