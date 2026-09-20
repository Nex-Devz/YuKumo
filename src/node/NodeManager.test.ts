import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodeManager } from "./NodeManager.ts";
import { Node } from "./Node.ts";
import { NodeSelector } from "./NodeSelector.ts";

describe("NodeManager", () => {
  let manager: NodeManager;

  beforeEach(() => {
    manager = new NodeManager("123456");
  });

  it("should add a node", () => {
    const node = manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
    });

    expect(node).toBeInstanceOf(Node);
    expect(manager.size()).toBe(1);
  });

  it("should generate id from host:port when name is not provided", () => {
    const node = manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
    });

    expect(node.id).toBe("localhost:2333");
  });

  it("should throw when adding duplicate node", () => {
    manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
    });

    expect(() =>
      manager.add({
        host: "localhost",
        port: 2333,
        password: "youshallnotpass",
        name: "test-node",
      }),
    ).toThrow('Node "test-node" already exists');
  });

  it("should remove a node", () => {
    manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
    });

    const removed = manager.remove("test-node");
    expect(removed).toBe(true);
    expect(manager.size()).toBe(0);
  });

  it("should return false when removing non-existent node", () => {
    expect(manager.remove("noop")).toBe(false);
  });

  it("should get a node by id", () => {
    manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
    });

    const node = manager.get("test-node");
    expect(node).toBeDefined();
    expect(node?.id).toBe("test-node");
  });

  it("should return undefined for non-existent node", () => {
    expect(manager.get("noop")).toBeUndefined();
  });

  it("should return all nodes", () => {
    manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "node-1",
    });
    manager.add({
      host: "localhost",
      port: 2334,
      password: "youshallnotpass",
      name: "node-2",
    });

    expect(manager.getAll()).toHaveLength(2);
  });

  it("should return only connected nodes", () => {
    const node1 = manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "node-1",
    });
    manager.add({
      host: "localhost",
      port: 2334,
      password: "youshallnotpass",
      name: "node-2",
    });

    Object.defineProperty(node1, "state", { value: "connected", configurable: true });

    const connected = manager.getConnected();
    expect(connected).toHaveLength(1);
    expect(connected[0]?.id).toBe("node-1");
  });

  it("should use default selector (LeastUsed)", () => {
    const node = manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
    });

    Object.defineProperty(node, "state", { value: "connected", configurable: true });

    const picked = manager.pick("guild-1");
    expect(picked).toBe(node);
  });

  it("should use custom selector", () => {
    const customSelector: NodeSelector = {
      pick: vi.fn(() => null),
    };

    manager.setSelector(customSelector);
    manager.pick("guild-1");

    expect(customSelector.pick).toHaveBeenCalled();
  });

  it("should pick null when no nodes", () => {
    expect(manager.pick("guild-1")).toBeNull();
  });

  it("should update userId on the manager and all registered nodes", () => {
    const node = manager.add({
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
    });
    const nodeSetUserId = vi.spyOn(node, "setUserId");

    manager.setUserId("999999");

    expect(nodeSetUserId).toHaveBeenCalledWith("999999");
    // A node added after setUserId must receive the new id
    const laterNode = manager.add({
      host: "localhost",
      port: 2334,
      password: "youshallnotpass",
      name: "later-node",
    });
    expect(laterNode.createVoiceReceiver("guild-9").guildId).toBe("guild-9");
  });
});

describe("NodeManager capability-aware pick", () => {
  function makeManager(): NodeManager {
    return new NodeManager("123456");
  }

  function forceConnected(node: Node): void {
    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
  }

  it("routes a feature request to a capable node in a mixed pool", () => {
    const manager = makeManager();
    const lavalink = manager.add({
      host: "h",
      port: 1,
      password: "p",
      name: "lava",
      type: "lavalink",
    });
    const nodelink = manager.add({
      host: "h",
      port: 2,
      password: "p",
      name: "nl",
      type: "nodelink",
    });
    forceConnected(lavalink);
    forceConnected(nodelink);

    const picked = manager.pick("guild-1", { feature: "voiceReceive" });
    expect(picked?.id).toBe("nl");
  });

  it("throws when no connected node supports the requested feature", () => {
    const manager = makeManager();
    const lavalink = manager.add({
      host: "h",
      port: 1,
      password: "p",
      name: "lava",
      type: "lavalink",
    });
    forceConnected(lavalink);

    expect(() => manager.pick("guild-1", { feature: "voiceReceive" })).toThrowError(
      /does not support the "voiceReceive" feature/,
    );
  });

  it("returns null (no throw) when the pool is empty for a feature request", () => {
    const manager = makeManager();
    expect(manager.pick("guild-1", { feature: "lyrics" })).toBeNull();
  });

  it("plain pick(guildId) is unchanged", () => {
    const manager = makeManager();
    const node = manager.add({ host: "h", port: 1, password: "p", name: "n" });
    forceConnected(node);
    expect(manager.pick("guild-1")?.id).toBe("n");
  });
});
