import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Listener = (...args: any[]) => void;

const mockState = vi.hoisted(() => {
  class MockWS {
    public static instances: MockWS[] = [];
    public handlers = new Map<string, Listener[]>();
    public closed = false;

    public constructor(
      public url: string,
      public options: Record<string, unknown>,
    ) {
      MockWS.instances.push(this);
    }

    public on(event: string, cb: Listener): void {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
    }

    public emit(event: string, ...args: any[]): void {
      for (const cb of this.handlers.get(event) ?? []) cb(...args);
    }

    public removeAllListeners(): void {
      this.handlers.clear();
    }

    public close(): void {
      this.closed = true;
    }
  }
  return { MockWS };
});

const MockWS = mockState.MockWS as typeof mockState.MockWS & {
  instances: InstanceType<typeof mockState.MockWS>[];
};
type MockWSInstance = InstanceType<typeof mockState.MockWS>;

vi.mock("ws", () => ({ default: mockState.MockWS }));

import { NodeLinkVoiceReceiver } from "./NodeLinkVoiceReceiver.ts";

function buildFrame(op: number, format: number, guildId: string, userId: string, payload?: Buffer): Buffer {
  const guild = Buffer.from(guildId, "utf8");
  const user = Buffer.from(userId, "utf8");
  const head = Buffer.from([op, format, guild.length]);
  const userLen = Buffer.from([user.length]);
  const ssrc = Buffer.alloc(4);
  ssrc.writeUInt32BE(1000, 0);
  const ts = Buffer.alloc(4);
  ts.writeUInt32BE(5000, 0);
  return Buffer.concat([head, guild, userLen, user, ssrc, ts, payload ?? Buffer.alloc(0)]);
}

function createReceiver(maxRetries = 3) {
  return new NodeLinkVoiceReceiver({
    nodeConfig: {
      host: "localhost",
      port: 2333,
      password: "pw",
      maxRetries,
      retryDelay: 50,
      retryDelayMax: 100,
    },
    userId: "bot-user",
    guildId: "guild-1",
    clientName: "YuKumo/0.0.1",
  });
}

describe("NodeLinkVoiceReceiver", () => {
  beforeEach(() => {
    (MockWS as unknown as { instances: unknown[] }).instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects to /v4/websocket/voice/:guildId with auth headers", async () => {
    const receiver = createReceiver();
    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;
    const headers = ws.options.headers as Record<string, unknown>;

    expect(ws.url).toBe("ws://localhost:2333/v4/websocket/voice/guild-1");
    expect(headers.Authorization).toBe("pw");
    expect(headers["User-Id"]).toBe("bot-user");

    ws.emit("open");
    await p;
    expect(receiver.connected).toBe(true);
  });

  it("parses binary start/data/stop frames into startSpeaking and endSpeaking", async () => {
    const receiver = createReceiver();
    const startSpeaking = vi.fn();
    const endSpeaking = vi.fn();
    receiver.on("startSpeaking", startSpeaking);
    receiver.on("endSpeaking", endSpeaking);

    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;
    ws.emit("open");
    await p;

    const audio = Buffer.from([1, 2, 3, 4]);
    ws.emit("message", buildFrame(1, 0, "guild-1", "user-1"), true);
    ws.emit("message", buildFrame(3, 0, "guild-1", "user-1", audio), true);
    ws.emit("message", buildFrame(2, 0, "guild-1", "user-1"), true);

    expect(startSpeaking).toHaveBeenCalledWith({ userId: "user-1", guildId: "guild-1" });
    expect(endSpeaking).toHaveBeenCalledWith({
      userId: "user-1",
      guildId: "guild-1",
      data: audio.toString("base64"),
      type: "opus",
    });
  });

  it("emits a per-frame data event for streaming consumers", async () => {
    const receiver = createReceiver();
    const data = vi.fn();
    receiver.on("data", data);

    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;
    ws.emit("open");
    await p;

    const audio = Buffer.from([9, 9]);
    ws.emit("message", buildFrame(3, 0, "guild-1", "user-1", audio), true);

    expect(data).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        guildId: "guild-1",
        ssrc: 1000,
        timestamp: 5000,
        payload: audio,
      }),
    );
  });

  it("handles legacy JSON /connection/data speak messages", async () => {
    const receiver = createReceiver();
    const endSpeaking = vi.fn();
    receiver.on("endSpeaking", endSpeaking);

    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;
    ws.emit("open");
    await p;

    ws.emit(
      "message",
      JSON.stringify({
        op: "speak",
        type: "endSpeakingEvent",
        data: { userId: "u", guildId: "g1", data: "c2c2", type: "opus" },
      }),
    );

    expect(endSpeaking).toHaveBeenCalledWith({ userId: "u", guildId: "g1", data: "c2c2", type: "opus" });
  });

  it("reconnects after an unexpected close and resets _connected", async () => {
    const receiver = createReceiver();
    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;
    ws.emit("open");
    await p;
    expect(receiver.connected).toBe(true);

    ws.emit("close", 1006, Buffer.from("gone"));
    expect(receiver.connected).toBe(false);

    await vi.waitFor(
      () => {
        expect(MockWS.instances.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 500 },
    );
  });

  it("does not reconnect after destroy", async () => {
    const receiver = createReceiver();
    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;
    ws.emit("open");
    await p;

    await receiver.destroy();
    expect(receiver.connected).toBe(false);

    const instanceCount = MockWS.instances.length;
    // closing the old socket must not schedule a reconnect
    await new Promise((r) => setTimeout(r, 150));
    expect(MockWS.instances.length).toBe(instanceCount);
  });

  it("rejects the connect promise when the socket closes before opening", async () => {
    const receiver = createReceiver();
    const p = receiver.connect();
    const ws: MockWSInstance = MockWS.instances[0] as unknown as MockWSInstance;

    ws.emit("close", 1006, Buffer.from("nope"));

    await expect(p).rejects.toThrow(/closed before opening/);
  });
});
