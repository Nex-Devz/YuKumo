import { describe, it, expect, vi } from "vitest";
import { Queue } from "./queue/Queue.ts";
import { FilterChain, AudioOutputs } from "./filters/FilterChain.ts";
import { parseLavalinkConnUrl } from "./utils/index.ts";
import { YuKumo } from "./Kumo.ts";

interface FakeTrack {
  encoded: string;
  info: { title: string; author: string; length: number };
}

function t(id: string, length = 1000): FakeTrack {
  return { encoded: id, info: { title: `t-${id}`, author: `a-${id}`, length } };
}

describe("Queue extras", () => {
  it("fires onChanged for mutations", () => {
    const queue = new Queue<FakeTrack>();
    const changed = vi.fn();
    queue.onChanged = changed;

    queue.enqueue(t("a"));
    queue.enqueue(t("b"));
    queue.shuffle();
    queue.clear();

    expect(changed.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("sortBy sorts upcoming tracks without touching the current one", () => {
    const queue = new Queue<FakeTrack>();
    queue.enqueue(t("cur", 500)).enqueue(t("c", 300)).enqueue(t("a", 100)).enqueue(t("b", 200));
    queue.start(); // current = "cur"

    queue.sortBy("duration");
    expect(queue.tracksList.map((x) => x.encoded)).toEqual(["cur", "a", "b", "c"]);

    queue.sortBy("duration", "desc");
    expect(queue.tracksList.map((x) => x.encoded)).toEqual(["cur", "c", "b", "a"]);
  });

  it("removeTrack removes by object/encoded but never the current track", () => {
    const queue = new Queue<FakeTrack>();
    const dup = t("x");
    queue.enqueue(t("cur")).enqueue(dup).enqueue(t("y")).enqueue(t("x"));
    queue.start();

    const removed = queue.removeTrack(dup); // matches both "x" entries by encoded
    expect(removed).toHaveLength(2);
    expect(queue.tracksList.map((x) => x.encoded)).toEqual(["cur", "y"]);
    expect(queue.currentTrack?.encoded).toBe("cur");

    // predicate form
    queue.removeTrack((track) => track.encoded === "y");
    expect(queue.tracksList.map((x) => x.encoded)).toEqual(["cur"]);

    // current track is protected
    expect(queue.removeTrack((track) => track.encoded === "cur")).toHaveLength(0);
  });
});

describe("parseLavalinkConnUrl", () => {
  it("parses lavalink:// urls", () => {
    expect(parseLavalinkConnUrl("lavalink://main:youshallnotpass@localhost:2333")).toEqual({
      name: "main",
      password: "youshallnotpass",
      host: "localhost",
      port: 2333,
      secure: false,
    });
  });

  it("marks https/wss urls secure and rejects garbage", () => {
    expect(parseLavalinkConnUrl("wss://node:pw@lava.example.com:443").secure).toBe(true);
    expect(() => parseLavalinkConnUrl("not a url")).toThrow();
  });
});

describe("FilterChain audio outputs", () => {
  it("applies channelMix presets and resets on stereo", () => {
    const chain = new FilterChain();
    chain.setAudioOutput("mono");
    expect(chain.toPayload().channelMix).toEqual(AudioOutputs.mono);

    chain.setAudioOutput("left");
    expect(chain.toPayload().channelMix).toEqual(AudioOutputs.left);

    chain.setAudioOutput("stereo");
    expect(chain.toPayload().channelMix).toBeUndefined();
  });
});

describe("YuKumo link policy", () => {
  it("rejects all links when linksAllowed is false", async () => {
    const kumo = new YuKumo({ nodes: [], userId: "1", linksAllowed: false });
    const res = await kumo.search("https://youtube.com/watch?v=abc");
    expect(res.loadType).toBe("error");
    expect(res.exception?.message).toContain("disabled");
  });

  it("rejects blacklisted links", async () => {
    const kumo = new YuKumo({ nodes: [], userId: "1", linksBlacklist: ["badsite.com", /evil/] });
    expect((await kumo.search("https://badsite.com/track")).loadType).toBe("error");
    expect((await kumo.search("https://www.evil-stream.io/x")).loadType).toBe("error");
  });

  it("enforces the whitelist for links but not for plain queries", async () => {
    const kumo = new YuKumo({ nodes: [], userId: "1", linksWhitelist: ["youtube.com"] });
    expect((await kumo.search("https://spotify.com/track/1")).loadType).toBe("error");
    // whitelisted link passes the policy (then falls to "empty" — no nodes configured)
    expect((await kumo.search("https://youtube.com/watch?v=abc")).loadType).toBe("empty");
    // non-URL queries are never gated
    expect((await kumo.search("never gonna give you up")).loadType).toBe("empty");
  });
});
