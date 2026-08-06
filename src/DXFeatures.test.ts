import { describe, it, expect, vi } from "vitest";
import { YuKumo } from "./Kumo.ts";
import { Queue } from "./queue/Queue.ts";
import { TTLCache } from "./utils/TTLCache.ts";
import type { TrackData } from "./types/protocol.ts";

function makeTrack(id: string): TrackData {
  return {
    encoded: `enc-${id}`,
    info: {
      identifier: id,
      isSeekable: true,
      author: "Artist",
      length: 1000,
      isStream: false,
      position: 0,
      title: id,
      uri: `https://x/${id}`,
      sourceName: "youtube",
      artworkUrl: null,
      isrc: null,
    },
    pluginInfo: {},
    userData: {},
  } as TrackData;
}

function makeKumo(): YuKumo {
  const kumo = new YuKumo({
    nodes: [{ host: "localhost", port: 2333, password: "p", name: "main" }],
    userId: "bot",
  } as never);
  const node = kumo.getNode("main")!;
  Object.defineProperty(node.ws, "state", { get: () => "connected", configurable: true });
  Object.defineProperty(node.ws, "sessionId", { get: () => "s1", configurable: true });
  node.rest.sessionId = "s1";
  // No real node behind these tests — REST calls must not hit the network
  vi.spyOn(node.rest, "destroyPlayer").mockResolvedValue(undefined as never);
  vi.spyOn(node.rest, "updatePlayer").mockResolvedValue({} as never);
  return kumo;
}

describe("waitUntilPlaying", () => {
  it("resolves when trackStart arrives", async () => {
    const kumo = makeKumo();
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    const wait = player.waitUntilPlaying(2000);
    kumo.getNode("main")!.ws.eventDispatcher.emit("trackStart", "g1", makeTrack("t1"));
    await expect(wait).resolves.toBeUndefined();
    expect(player.status).toBe("playing");
  });

  it("resolves immediately when already playing", async () => {
    const kumo = makeKumo();
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    kumo.getNode("main")!.ws.eventDispatcher.emit("trackStart", "g1", makeTrack("t1"));
    await expect(player.waitUntilPlaying(1)).resolves.toBeUndefined();
  });

  it("rejects on timeout", async () => {
    const kumo = makeKumo();
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    await expect(player.waitUntilPlaying(10)).rejects.toThrow("did not start within 10ms");
  });

  it("rejects on destroy", async () => {
    const kumo = makeKumo();
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    const wait = player.waitUntilPlaying(5000);
    await player.destroy();
    await expect(wait).rejects.toThrow("destroyed");
  });
});

describe("isVoiceReady", () => {
  it("false without credentials, true with credentials + connected node", async () => {
    const kumo = makeKumo();
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    expect(player.isVoiceReady).toBe(false);
    player.setVoiceState({ sessionId: "vs", channelId: "vc", endpoint: "ep", token: "tok" });
    expect(player.isVoiceReady).toBe(true);
  });
});

describe("queue.lock", () => {
  it("serializes concurrent sections", async () => {
    const queue = new Queue<number>();
    const order: string[] = [];
    const a = queue.lock(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      queue.enqueue(1);
      order.push("a-end");
    });
    const b = queue.lock(async () => {
      order.push("b-start");
      queue.enqueue(2);
      order.push("b-end");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    expect(queue.tracksList).toEqual([1, 2]);
  });

  it("propagates errors without breaking the chain", async () => {
    const queue = new Queue<number>();
    await expect(queue.lock(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(queue.lock(() => 42)).resolves.toBe(42);
  });

  it("returns the section's value and reports isLocked", async () => {
    const queue = new Queue<number>();
    expect(queue.isLocked).toBe(false);
    const result = await queue.lock(async () => {
      expect(queue.isLocked).toBe(true);
      return "done";
    });
    expect(result).toBe("done");
    expect(queue.isLocked).toBe(false);
  });
});

describe("queue.unique", () => {
  it("removes duplicates by encoded, keeps first occurrence", () => {
    const queue = new Queue<TrackData>();
    queue.enqueue(makeTrack("a"));
    queue.enqueue(makeTrack("b"));
    queue.enqueue(makeTrack("a"));
    queue.enqueue(makeTrack("c"));
    queue.enqueue(makeTrack("b"));
    const removed = queue.unique();
    expect(removed).toHaveLength(2);
    expect(queue.tracksList.map((t) => t.info!.identifier)).toEqual(["a", "b", "c"]);
  });

  it("never removes the current track and fixes currentIndex", () => {
    const queue = new Queue<TrackData>();
    queue.enqueue(makeTrack("a"));
    queue.enqueue(makeTrack("b"));
    queue.enqueue(makeTrack("b"));
    queue.start(); // current = a (index 0)
    queue.next(); // current = b
    const current = queue.currentTrack;
    queue.unique();
    expect(queue.currentTrack).toBe(current);
    expect(queue.tracksList.filter((t) => t.info!.identifier === "b")).toHaveLength(1);
  });

  it("supports a custom key function", () => {
    const queue = new Queue<TrackData>();
    queue.enqueue(makeTrack("x1"));
    queue.enqueue(makeTrack("x2"));
    const removed = queue.unique((t) => t.info!.author); // same author
    expect(removed).toHaveLength(1);
    expect(queue.size).toBe(1);
  });
});

describe("players.find / kumo.findPlayers", () => {
  it("filters by node, status, playing, and custom predicate", async () => {
    const kumo = makeKumo();
    const p1 = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc1" });
    const p2 = await kumo.createPlayer({ guildId: "g2", voiceChannelId: "vc2" });
    kumo.getNode("main")!.ws.eventDispatcher.emit("trackStart", "g2", makeTrack("t"));

    expect(kumo.findPlayers({ node: "main" })).toHaveLength(2);
    expect(kumo.findPlayers({ status: "playing" })).toEqual([p2]);
    expect(kumo.findPlayers({ playing: false })).toEqual([p1]);
    expect(kumo.findPlayers({ voiceChannelId: "vc1" })).toEqual([p1]);
    expect(kumo.findPlayers({ filter: (p) => p.guildId === "g2" })).toEqual([p2]);
    expect(kumo.findPlayers({ status: ["playing", "paused"] })).toEqual([p2]);
    expect(kumo.players.findOne({ node: "main" })).toBe(p1);
    expect(kumo.findPlayers({ node: "nope" })).toEqual([]);
  });
});

describe("node maintenance mode", () => {
  it("excluded from load balancing; existing players untouched", async () => {
    const kumo = makeKumo();
    await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    const node = kumo.getNode("main")!;
    expect(node.maintenance).toBe(false);

    node.setMaintenance(true);
    expect(node.maintenance).toBe(true);
    // no eligible node anymore → pick returns null
    expect(kumo.nodes.pick("g-new")).toBeNull();
    // existing player untouched
    expect(kumo.getPlayer("g1")).toBeDefined();
    expect(node.playerCount).toBe(1);

    node.setMaintenance(false);
    expect(kumo.nodes.pick("g-new")).toBe(node);
  });

  it("drain resolves once playerCount hits zero", async () => {
    const kumo = makeKumo();
    const node = kumo.getNode("main")!;
    await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    node.setMaintenance(true);
    const drained = node.drain(5000, 5);
    await kumo.destroyPlayer("g1");
    await expect(drained).resolves.toBeUndefined();
  });
});

describe("player.cache (TTL)", () => {
  it("expires entries after ttl, keeps permanent ones", async () => {
    vi.useFakeTimers();
    try {
      const cache = new TTLCache<string, unknown>();
      cache.set("vote", true, 60_000);
      cache.set("forever", 1);
      expect(cache.get("vote")).toBe(true);
      vi.advanceTimersByTime(60_001);
      expect(cache.get("vote")).toBeUndefined();
      expect(cache.has("vote")).toBe(false);
      expect(cache.get("forever")).toBe(1);
      expect(cache.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is exposed on players and cleared on destroy", async () => {
    const kumo = makeKumo();
    const player = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc" });
    player.cache.set("k", "v", 10_000);
    expect(player.cache.get("k")).toBe("v");
    await player.destroy();
    expect(player.cache.size).toBe(0);
  });
});

describe("kumo.broadcast", () => {
  it("applies to all players; failures don't block others", async () => {
    const kumo = makeKumo();
    const p1 = await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc1" });
    const p2 = await kumo.createPlayer({ guildId: "g2", voiceChannelId: "vc2" });

    const touched: string[] = [];
    const results = await kumo.broadcast(async (p) => {
      if (p.guildId === "g1") throw new Error("nope");
      touched.push(p.guildId);
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
    expect(touched).toEqual(["g2"]);
    expect([p1, p2]).toHaveLength(2);
  });

  it("respects criteria subset", async () => {
    const kumo = makeKumo();
    await kumo.createPlayer({ guildId: "g1", voiceChannelId: "vc1" });
    await kumo.createPlayer({ guildId: "g2", voiceChannelId: "vc2" });
    kumo.getNode("main")!.ws.eventDispatcher.emit("trackStart", "g2", makeTrack("t"));

    const touched: string[] = [];
    await kumo.broadcast((p) => {
      touched.push(p.guildId);
    }, { status: "playing" });
    expect(touched).toEqual(["g2"]);
  });
});
