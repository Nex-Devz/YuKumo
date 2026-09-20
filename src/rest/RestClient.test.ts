import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { RestClient } from "./RestClient.ts";
import { RestError } from "../errors/index.ts";
import type { TrackData } from "../types/protocol.ts";

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function makeEncodedTrack(encoded: string): TrackData {
  return {
    encoded,
    info: {
      identifier: encoded,
      isSeekable: true,
      author: "a",
      length: 1000,
      isStream: false,
      position: 0,
      title: encoded,
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "youtube",
    },
    pluginInfo: {},
  };
}

function createClient(sessionId?: string) {
  return new RestClient({
    host: "localhost",
    port: 2333,
    password: "youshallnotpass",
    sessionId,
    retryOptions: { maxRetries: 0 },
  });
}

function mockResponse(status: number, body: unknown, statusText?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText ?? "",
    json: async () => body,
  };
}

describe("RestClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("should set sessionId from options", () => {
      const client = createClient("test-session");
      expect(client.sessionId).toBe("test-session");
    });

    it("should default sessionId to null", () => {
      const client = createClient();
      expect(client.sessionId).toBeNull();
    });
  });

  describe("updateSession", () => {
    it("should PATCH session with resuming and timeout", async () => {
      const client = createClient("sess-1");
      mockFetch.mockResolvedValue(mockResponse(200, { resuming: true, timeout: 60 }));

      const result = await client.updateSession("sess-1", {
        resuming: true,
        timeout: 60,
      });

      expect(result).toEqual({ resuming: true, timeout: 60 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v4/sessions/sess-1"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ resuming: true, timeout: 60 }),
        }),
      );
    });
  });

  describe("getPlayers", () => {
    it("should GET players list", async () => {
      const client = createClient("sess-1");
      const players = [
        {
          guildId: "123",
          volume: 100,
          paused: false,
          state: { time: 0, position: 0, connected: true, ping: 0 },
          voice: { token: "", endpoint: "", sessionId: "" },
          filters: {},
        },
      ] as unknown[];
      mockFetch.mockResolvedValue(mockResponse(200, players));

      const result = await client.getPlayers("sess-1");
      expect(result).toEqual(players);
    });
  });

  describe("getPlayer", () => {
    it("should return player when exists", async () => {
      const client = createClient("sess-1");
      const player = {
        guildId: "123",
        volume: 100,
        paused: false,
        state: { time: 0, position: 0, connected: true, ping: 0 },
        voice: { token: "", endpoint: "", sessionId: "" },
        filters: {},
      };
      mockFetch.mockResolvedValue(mockResponse(200, player));

      const result = await client.getPlayer("sess-1", "123");
      expect(result).toEqual(player);
    });

    it("should return null on 404", async () => {
      const client = createClient("sess-1");
      mockFetch.mockResolvedValue(mockResponse(404, { message: "Not found" }, "Not Found"));

      const result = await client.getPlayer("sess-1", "123");
      expect(result).toBeNull();
    });
  });

  describe("updatePlayer", () => {
    it("should PATCH player with track and options", async () => {
      const client = createClient("sess-1");
      const playerData = {
        guildId: "123",
        track: null,
        volume: 50,
        paused: false,
        state: { time: 0, position: 0, connected: true, ping: 0 },
        voice: { token: "", endpoint: "", sessionId: "" },
        filters: {},
      };
      mockFetch.mockResolvedValue(mockResponse(200, playerData));

      const result = await client.updatePlayer("sess-1", "123", {
        volume: 50,
      });

      expect(result).toEqual(playerData);
    });

    it("should pass noReplace query param", async () => {
      const client = createClient("sess-1");
      mockFetch.mockResolvedValue(
        mockResponse(200, {
          guildId: "123",
          volume: 100,
          paused: false,
          state: { time: 0, position: 0, connected: true, ping: 0 },
          voice: { token: "", endpoint: "", sessionId: "" },
          filters: {},
        }),
      );

      await client.updatePlayer("sess-1", "123", { volume: 100 }, true);

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain("noReplace=true");
    });
  });

  describe("destroyPlayer", () => {
    it("should DELETE player", async () => {
      const client = createClient("sess-1");
      mockFetch.mockResolvedValue(mockResponse(204, null));

      await client.destroyPlayer("sess-1", "123");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v4/sessions/sess-1/players/123"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("loadTracks", () => {
    it("should GET loadtracks with identifier", async () => {
      const client = createClient();
      const result = { loadType: "search", data: [] };
      mockFetch.mockResolvedValue(mockResponse(200, result));

      const response = await client.loadTracks("ytsearch:test");
      expect(response).toEqual(result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("identifier=ytsearch%3Atest"),
        expect.any(Object),
      );
    });
  });

  describe("resolveTrack", () => {
    it("returns the server-selected playlist track instead of tracks[0]", async () => {
      const client = createClient();
      const trackA = makeEncodedTrack("A");
      const trackD = makeEncodedTrack("D");
      mockFetch.mockResolvedValue(
        mockResponse(200, {
          loadType: "playlist",
          data: {
            info: { name: "Up Next", selectedTrack: 3 },
            pluginInfo: {},
            tracks: [trackA, makeEncodedTrack("B"), makeEncodedTrack("C"), trackD],
          },
        }),
      );

      const result = await client.resolveTrack("https://example.com/upnext");
      expect(result.encoded).toBe("D");
    });

    it("clamps an out-of-range selectedTrack to the last track", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        mockResponse(200, {
          loadType: "playlist",
          data: {
            info: { name: "P", selectedTrack: 99 },
            pluginInfo: {},
            tracks: [makeEncodedTrack("A")],
          },
        }),
      );

      const result = await client.resolveTrack("https://example.com/p");
      expect(result.encoded).toBe("A");
    });
  });

  describe("decodeTrack", () => {
    it("should GET decodetrack with encodedTrack", async () => {
      const client = createClient();
      const track = {
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
      };
      mockFetch.mockResolvedValue(mockResponse(200, track));

      const result = await client.decodeTrack("AAA");
      expect(result).toEqual(track);
    });
  });

  describe("decodeTracks", () => {
    it("should POST decodetracks with array", async () => {
      const client = createClient();
      const tracks = [
        {
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
      ];
      mockFetch.mockResolvedValue(mockResponse(200, tracks));

      const result = await client.decodeTracks(["AAA"]);
      expect(result).toEqual(tracks);
    });
  });

  describe("getInfo", () => {
    it("should GET info", async () => {
      const client = createClient();
      const info = {
        version: { semver: "4.0.0", major: 4, minor: 0, patch: 0, preRelease: null, build: null },
        buildTime: 0,
        git: { branch: "main", commit: "abc", commitTime: 0 },
        jvm: "21",
        lavaplayer: "1.0",
        sourceManagers: [],
        filters: [],
        plugins: [],
      };
      mockFetch.mockResolvedValue(mockResponse(200, info));

      const result = await client.getInfo();
      expect(result).toEqual(info);
    });
  });

  describe("getStats", () => {
    it("should GET stats", async () => {
      const client = createClient();
      const stats = {
        players: 1,
        playingPlayers: 0,
        uptime: 1000,
        memory: { free: 100, used: 200, allocated: 300, reservable: 400 },
        cpu: { cores: 4, systemLoad: 0.5, lavalinkLoad: 0.2 },
      };
      mockFetch.mockResolvedValue(mockResponse(200, stats));

      const result = await client.getStats();
      expect(result).toEqual(stats);
    });
  });

  describe("getVersion", () => {
    it("should GET version", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, "4.0.0"));

      const result = await client.getVersion();
      expect(result).toBe("4.0.0");
    });
  });

  describe("error handling", () => {
    it("should throw RestError on non-ok response", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(400, { message: "Bad request" }, "Bad Request"));

      await expect(client.getInfo()).rejects.toThrow(RestError);
    });

    it("should throw RestError with status code", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(401, { message: "Unauthorized" }, "Unauthorized"));

      try {
        await client.getInfo();
      } catch (error) {
        expect(error).toBeInstanceOf(RestError);
        expect((error as RestError).statusCode).toBe(401);
      }
    });
  });

  describe("sessionId setter", () => {
    it("should update sessionId", () => {
      const client = createClient("old");
      client.sessionId = "new";
      expect(client.sessionId).toBe("new");
    });
  });
});
