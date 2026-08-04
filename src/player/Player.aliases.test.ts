import { describe, it, expect, vi } from "vitest";
import { Player } from "./Player.ts";
import { Node } from "../node/Node.ts";

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

describe("Player Aliases", () => {
  it("should get voiceId as voiceChannelId", () => {
    const player = createPlayer();
    expect(player.voiceId).toBe(player.voiceChannelId);
  });

  it("should set voiceId to update voice channel ID", () => {
    const player = createPlayer();
    player.voiceId = "new-voice-id";
    expect(player.voiceChannelId).toBe("new-voice-id");
  });

  it("should get textId as textChannelId", () => {
    const player = createPlayer();
    expect(player.textId).toBe(player.textChannelId);
  });

  it("should set textId to update text channel ID", () => {
    const player = createPlayer();
    player.textId = "new-text-id";
    expect(player.textChannelId).toBe("new-text-id");
  });

  it("should return false for connected when no voice credentials exist", () => {
    const player = createPlayer();
    expect(player.connected).toBe(false);
  });

  it("should return true for connected when voice credentials exist and node is connected", () => {
    const node = createMockNode();
    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
    const player = createPlayer(node);

    player.updateVoiceState({
      sessionId: "sess",
      endpoint: "ep",
      token: "tok",
      channelId: "ch",
    });

    expect(player.connected).toBe(true);
  });

  it("should get filterManager as filters", () => {
    const player = createPlayer();
    expect(player.filterManager).toBe(player.filters);
  });

  it("should pause when setPaused(true) is called", async () => {
    const player = createPlayer();
    vi.spyOn(player, "pause").mockResolvedValue(undefined);
    await player.setPaused(true);
    expect(player.pause).toHaveBeenCalled();
  });

  it("should resume when setPaused(false) is called", async () => {
    const player = createPlayer();
    vi.spyOn(player, "resume").mockResolvedValue(undefined);
    await player.setPaused(false);
    expect(player.resume).toHaveBeenCalled();
  });

  it("should move to node when move is called", async () => {
    const player = createPlayer();
    const newNode = createMockNode("new-node");
    vi.spyOn(player, "setNode").mockResolvedValue(undefined);
    await player.move(newNode);
    expect(player.setNode).toHaveBeenCalledWith(newNode);
  });

  it("should set voice channel when setVoice is called", async () => {
    const player = createPlayer();
    vi.spyOn(player, "setVoiceChannel").mockResolvedValue(undefined);
    await player.setVoice({ voiceId: "new-channel-2" });
    expect(player.setVoiceChannel).toHaveBeenCalled();
  });
});
