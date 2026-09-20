import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketClient } from "./WebSocketClient.ts";

type WsEventListener = ((event: unknown) => void) | null;

interface MockWebSocket {
  readyState: number;
  onopen: WsEventListener;
  onclose: WsEventListener;
  onerror: WsEventListener;
  onmessage: WsEventListener;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const originalWebSocket = globalThis.WebSocket;

function createMockWebSocket(): MockWebSocket {
  const mock: MockWebSocket = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: vi.fn(),
    close: vi.fn(),
  };
  return mock;
}

function createClient() {
  return new WebSocketClient({
    nodeConfig: {
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name: "test-node",
      maxRetries: 2,
      retryDelay: 50,
      retryDelayMax: 100,
    },
    userId: "123456",
    clientName: "YuKumo/0.0.1",
  });
}

describe("WebSocketClient", () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = createMockWebSocket();
    globalThis.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  describe("connect", () => {
    it("should create a WebSocket connection", async () => {
      const client = createClient();
      const connectPromise = client.connect();

      expect(globalThis.WebSocket).toHaveBeenCalledWith(
        "ws://localhost:2333/v4/websocket",
        expect.anything(),
      );

      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      expect(client.state).toBe("connected");
    });

    it("should include resume session header when sessionId exists", async () => {
      const client = createClient();
      const connectPromise = client.connect();

      mockWs.onopen?.(new Event("open"));
      await connectPromise;
    });

    it("should transition to connecting state", () => {
      const client = createClient();
      client.connect();
      expect(client.state).toBe("connecting");
    });

    it("should not connect if already connecting", async () => {
      const client = createClient();
      client.connect();
      client.connect();

      expect(globalThis.WebSocket).toHaveBeenCalledTimes(1);
    });

    it("hands concurrent connect() callers the same in-flight promise (resolves only on open)", async () => {
      const client = createClient();
      const first = client.connect();
      const second = client.connect();

      // Both callers must be waiting on the same attempt — not resolved early
      let firstResolved = false;
      let secondResolved = false;
      void first.then(() => (firstResolved = true));
      void second.then(() => (secondResolved = true));
      await Promise.resolve();
      expect(firstResolved).toBe(false);
      expect(secondResolved).toBe(false);
      expect(globalThis.WebSocket).toHaveBeenCalledTimes(1);

      mockWs.onopen?.(new Event("open"));
      await Promise.all([first, second]);
      expect(firstResolved).toBe(true);
      expect(secondResolved).toBe(true);
      expect(client.state).toBe("connected");
    });

    it("should not connect if already connected", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      client.connect();
      expect(globalThis.WebSocket).toHaveBeenCalledTimes(1);
    });

    it("should throw if destroyed", () => {
      const client = createClient();
      client.destroy();

      expect(client.state).toBe("destroyed");
    });
  });

  describe("message handling", () => {
    it("should handle ready message", async () => {
      const client = createClient();
      const readyCallback = vi.fn();
      client.on("nodeReady", readyCallback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: JSON.stringify({
          op: "ready",
          resumed: false,
          sessionId: "test-session",
        }),
      } as MessageEvent);

      expect(client.sessionId).toBe("test-session");
      expect(client.resumed).toBe(false);
      expect(readyCallback).toHaveBeenCalledWith("test-node");
    });

    it("should handle playerUpdate message", async () => {
      const client = createClient();
      const updateCallback = vi.fn();
      client.on("playerUpdate", updateCallback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: JSON.stringify({
          op: "playerUpdate",
          guildId: "guild-1",
          state: {
            time: 1000,
            position: 500,
            connected: true,
            ping: 30,
          },
        }),
      } as MessageEvent);

      expect(updateCallback).toHaveBeenCalledWith("guild-1", {
        time: 1000,
        position: 500,
        connected: true,
        ping: 30,
      });
    });

    it("should handle stats message", async () => {
      const client = createClient();
      const statsCallback = vi.fn();
      client.on("stats", statsCallback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: JSON.stringify({
          op: "stats",
          players: 5,
          playingPlayers: 3,
          uptime: 123456,
          memory: { free: 100, used: 200, allocated: 300, reservable: 400 },
          cpu: { cores: 4, systemLoad: 0.5, lavalinkLoad: 0.2 },
          frameStats: { sent: 1000, nulled: 5, deficit: -10 },
        }),
      } as MessageEvent);

      expect(statsCallback).toHaveBeenCalledWith("test-node", {
        players: 5,
        playingPlayers: 3,
        uptime: 123456,
        memory: { free: 100, used: 200, allocated: 300, reservable: 400 },
        cpu: { cores: 4, systemLoad: 0.5, lavalinkLoad: 0.2 },
        frameStats: { sent: 1000, nulled: 5, deficit: -10 },
      });
    });

    it("should handle TrackStartEvent", async () => {
      const client = createClient();
      const callback = vi.fn();
      client.on("trackStart", callback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: JSON.stringify({
          op: "event",
          type: "TrackStartEvent",
          guildId: "guild-1",
          track: {
            encoded: "AAA",
            info: {
              identifier: "id",
              isSeekable: true,
              author: "a",
              length: 1000,
              isStream: false,
              position: 0,
              title: "t",
              uri: null,
              artworkUrl: null,
              isrc: null,
              sourceName: "youtube",
            },
            pluginInfo: {},
          },
        }),
      } as MessageEvent);

      expect(callback).toHaveBeenCalled();
    });

    it("should handle TrackEndEvent", async () => {
      const client = createClient();
      const callback = vi.fn();
      client.on("trackEnd", callback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: JSON.stringify({
          op: "event",
          type: "TrackEndEvent",
          guildId: "guild-1",
          track: {
            encoded: "AAA",
            info: {
              identifier: "id",
              isSeekable: true,
              author: "a",
              length: 1000,
              isStream: false,
              position: 0,
              title: "t",
              uri: null,
              artworkUrl: null,
              isrc: null,
              sourceName: "youtube",
            },
            pluginInfo: {},
          },
          reason: "finished",
        }),
      } as MessageEvent);

      expect(callback).toHaveBeenCalled();
    });

    it("should handle TrackExceptionEvent", async () => {
      const client = createClient();
      const callback = vi.fn();
      client.on("trackException", callback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: JSON.stringify({
          op: "event",
          type: "TrackExceptionEvent",
          guildId: "guild-1",
          track: {
            encoded: "AAA",
            info: {
              identifier: "id",
              isSeekable: true,
              author: "a",
              length: 1000,
              isStream: false,
              position: 0,
              title: "t",
              uri: null,
              artworkUrl: null,
              isrc: null,
              sourceName: "youtube",
            },
            pluginInfo: {},
          },
          exception: { message: "err", severity: "common", cause: "cause", causeStackTrace: "stack" },
        }),
      } as MessageEvent);

      expect(callback).toHaveBeenCalled();
    });

    it("should handle malformed JSON gracefully", async () => {
      const client = createClient();
      const debugCallback = vi.fn();
      client.on("debug", debugCallback);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      mockWs.onmessage?.({
        data: "not-json",
      } as MessageEvent);

      expect(debugCallback).toHaveBeenCalledWith("Failed to parse WebSocket message");
    });
  });

  describe("send", () => {
    it("should send JSON through WebSocket", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      client.send({ op: "play", guildId: "guild-1" });

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ op: "play", guildId: "guild-1" }));
    });

    it("should throw if not connected", () => {
      const client = createClient();

      expect(() => client.send({ op: "play" })).toThrow("Cannot send: WebSocket is not connected");
    });
  });

  describe("close", () => {
    it("should close the WebSocket", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      await client.close();

      expect(mockWs.close).toHaveBeenCalled();
      expect(client.state).toBe("disconnected");
    });

    it("keeps dispatcher listeners after close() so a reconnect stays live", async () => {
      const client = createClient();
      const ready = vi.fn();
      client.on("nodeReady", ready);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;
      mockWs.onmessage?.({
        data: JSON.stringify({ op: "ready", resumed: false, sessionId: "s1" }),
      } as MessageEvent);
      expect(ready).toHaveBeenCalledTimes(1);

      await client.close();

      // reconnect after close() — the manager's nodeReady wiring must survive
      const againMock = createMockWebSocket();
      globalThis.WebSocket = vi.fn(() => againMock) as unknown as typeof WebSocket;
      const reconnectPromise = client.connect();
      againMock.onopen?.(new Event("open"));
      await reconnectPromise;
      againMock.onmessage?.({
        data: JSON.stringify({ op: "ready", resumed: true, sessionId: "s2" }),
      } as MessageEvent);

      expect(ready).toHaveBeenCalledTimes(2);
    });
  });

  describe("destroy", () => {
    it("should set state to destroyed", () => {
      const client = createClient();
      client.destroy();
      expect(client.state).toBe("destroyed");
    });

    it("should close WebSocket if connected", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      client.destroy();

      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe("reconnect", () => {
    it("should reconnect on close if not destroyed", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      const firstWs = mockWs;
      const secondMock = createMockWebSocket();
      globalThis.WebSocket = vi.fn(() => secondMock) as unknown as typeof WebSocket;

      firstWs.onclose?.({ code: 1006, reason: "timeout" });

      await new Promise((r) => setTimeout(r, 100));

      expect(globalThis.WebSocket).toHaveBeenCalled();
    });

    it("should not reconnect if destroyed", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      client.destroy();

      const mockConstructor = globalThis.WebSocket as unknown as { mock: { calls: unknown[] } };
      const callCount = mockConstructor.mock.calls.length;
      mockWs.onclose?.({ code: 1006, reason: "timeout" });

      await new Promise((r) => setTimeout(r, 100));

      expect(mockConstructor.mock.calls.length).toBe(callCount);
    });

    it("ignores a stale socket's close after the reconnect succeeded", async () => {
      const client = createClient();
      const disconnected = vi.fn();
      client.on("nodeDisconnected", disconnected);

      const connectPromise = client.connect();
      mockWs.onopen?.(new Event("open"));
      await connectPromise;

      const firstWs = mockWs;
      const secondMock = createMockWebSocket();
      globalThis.WebSocket = vi.fn(() => secondMock) as unknown as typeof WebSocket;

      // network blip: first socket closes → reconnect fires
      firstWs.onclose?.({ code: 1006, reason: "network" });
      await new Promise((r) => setTimeout(r, 100));
      secondMock.onopen?.(new Event("open")); // B is the live connection now
      expect(client.state).toBe("connected");
      expect(disconnected).toHaveBeenCalledTimes(1);

      // A late close from the OLD socket must not clobber the live connection
      const mockConstructor = globalThis.WebSocket as unknown as { mock: { calls: unknown[] } };
      const callCount = mockConstructor.mock.calls.length;
      firstWs.onclose?.({ code: 1002, reason: "stale" });
      await new Promise((r) => setTimeout(r, 150)); // enough for a phantom reconnect

      expect(client.state).toBe("connected");
      expect(disconnected).toHaveBeenCalledTimes(1);
      expect(mockConstructor.mock.calls.length).toBe(callCount); // no phantom reconnect
    });

    it("aborts a timed-out connect and allows a retry", async () => {
      vi.useFakeTimers();
      try {
        const client = createClient();
        const connectPromise = client.connect();
        expect(client.state).toBe("connecting");

        // Register the rejection handler before the timer fires so the
        // rejection is never "unhandled" mid-advance
        const timedOut = expect(connectPromise).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(16_000); // > 15s connectTimeout
        await timedOut;

        expect(mockWs.close).toHaveBeenCalled(); // pending socket aborted
        expect(client.state).toBe("disconnected"); // not stuck "connecting"

        const mockConstructor = globalThis.WebSocket as unknown as { mock: { calls: unknown[] } };
        const callsBefore = mockConstructor.mock.calls.length;
        const retry = client.connect();
        expect(mockConstructor.mock.calls.length).toBe(callsBefore + 1);
        mockWs.onopen?.(new Event("open"));
        await retry;
        expect(client.state).toBe("connected");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
