import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { RestClient } from "./RestClient.ts";

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

function createClient(isNodeLink: boolean = true, sessionId: string = "sess-1") {
  return new RestClient({
    host: "localhost",
    port: 2333,
    password: "youshallnotpass",
    sessionId,
    isNodeLink,
    retryOptions: { maxRetries: 0 },
  });
}

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => String(body),
  };
}

function urlOf(call: unknown): string {
  return (call as any[])[0] as string;
}

describe("RestClient (NodeLink)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getVersion", () => {
    it("routes /version to the root for NodeLink nodes", async () => {
      const client = createClient(true);
      mockFetch.mockResolvedValue(mockResponse(200, "4.0.7"));

      await client.getVersion();

      expect(urlOf(mockFetch.mock.calls[0])).toBe("http://localhost:2333/version");
    });

    it("routes /version under /v4 for Lavalink nodes", async () => {
      const client = createClient(false);
      mockFetch.mockResolvedValue(mockResponse(200, "4.7.0"));

      await client.getVersion();

      expect(urlOf(mockFetch.mock.calls[0])).toBe("http://localhost:2333/v4/version");
    });
  });

  describe("SponsorBlock", () => {
    it("GETs full sponsorblock state from the NodeLink path", async () => {
      const client = createClient();
      const state = { enabled: true, categories: ["sponsor"], actionTypes: ["skip"], segments: [], skipMarginMs: 150 };
      mockFetch.mockResolvedValue(mockResponse(200, state));

      const result = await client.getNodeLinkSponsorBlock("sess-1", "12345678901234567");

      expect(result).toEqual(state);
      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/sessions/sess-1/players/12345678901234567/sponsorblock");
      expect((mockFetch.mock.calls[0] as any[])[1].method).toBe("GET");
    });

    it("PATCHes sponsorblock settings", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await client.updateNodeLinkSponsorBlock("sess-1", "12345678901234567", {
        enabled: true,
        categories: ["sponsor", "intro"],
      });

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/sponsorblock");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({ enabled: true, categories: ["sponsor", "intro"] });
    });

    it("POSTs segment overrides", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await client.setNodeLinkSponsorBlockSegments("sess-1", "12345678901234567", [
        { start: 1000, end: 2000, category: "sponsor" },
      ]);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/sponsorblock");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        segments: [{ start: 1000, end: 2000, category: "sponsor" }],
      });
    });

    it("DELETEs sponsorblock state", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(204, undefined));

      await client.deleteNodeLinkSponsorBlock("sess-1", "12345678901234567");

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/sponsorblock");
      expect(init.method).toBe("DELETE");
    });
  });

  describe("encodeTrack / encodeTracks", () => {
    it("POSTs a single track info to /v4/encodetrack", async () => {
      const client = createClient();
      const payload = {
        title: "T",
        author: "A",
        length: 1000,
        identifier: "id",
        isStream: false,
        sourceName: "youtube",
        position: 0,
      };
      mockFetch.mockResolvedValue(mockResponse(200, "AAA"));

      const result = await client.encodeTrack(payload);

      expect(result).toBe("AAA");
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/v4/encodetrack");
      expect(init.method).toBe("POST");
    });

    it("POSTs an array to /v4/encodedtracks", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, ["AAA", "BBB"]));

      const result = await client.encodeTracks([{ title: "T", author: "A", length: 1, identifier: "i", isStream: false, sourceName: "youtube", position: 0 } as never]);

      expect(result).toEqual(["AAA", "BBB"]);
      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/encodedtracks");
    });
  });

  describe("loadStream / trackstream", () => {
    it("POSTs loadStream options to /v4/loadstream and returns the raw response", async () => {
      const client = createClient();
      const raw = { ok: true, status: 200, body: null } as unknown as Response;
      mockFetch.mockResolvedValue(raw);

      const result = await client.loadStream({ encodedTrack: "AAA", volume: 100, position: 0 });

      expect(result).toBe(raw);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/v4/loadstream");
      expect(JSON.parse(init.body as string)).toEqual({ encodedTrack: "AAA", volume: 100, position: 0 });
    });

    it("GETs trackstream with encodedTrack and itag", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, { url: "https://x", protocol: "https", format: "raw" }));

      await client.getTrackStream("AAA", 22);

      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/trackstream");
      expect(urlOf(mockFetch.mock.calls[0])).toContain("encodedTrack=AAA");
      expect(urlOf(mockFetch.mock.calls[0])).toContain("itag=22");
    });
  });

  describe("metrics / workers / youtube", () => {
    it("returns Prometheus text from /v4/metrics", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, "yukumo_metric 1"));

      const result = await client.getMetrics();

      expect(result).toBe("yukumo_metric 1");
      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/metrics");
    });

    it("lists workers from /v4/workers", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, [{ id: 1 }]));

      const result = await client.getWorkers();

      expect(result).toEqual([{ id: 1 }]);
    });

    it("GETs and PATCHes youtube config", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, { refreshToken: "***", isConfigured: true, isValid: null }));

      await client.getYouTubeConfig(true);
      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/youtube/config?validate=true");

      mockFetch.mockResolvedValue(mockResponse(200, { message: "ok" }));
      await client.setYouTubeConfig({ refreshToken: "rt" });
      const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toContain("/v4/youtube/config");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "rt" });
    });

    it("GETs youtube oauth with refreshToken query", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, { access_token: "at" }));

      await client.getYouTubeOAuth("rt");

      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/youtube/oauth?refreshToken=rt");
    });
  });

  describe("multi-guild sync groups", () => {
    it("lists, creates, fetches, updates, and deletes groups under the session", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, []));
      await client.getGroups("sess-1");
      expect(urlOf(mockFetch.mock.calls[0])).toContain("/v4/sessions/sess-1/groups");

      mockFetch.mockResolvedValue(mockResponse(201, { id: "g1", guildIds: [], createdAt: 0 }));
      await client.createGroup("sess-1", { id: "g1" });
      expect((mockFetch.mock.calls[1] as any[])[1].method).toBe("POST");

      mockFetch.mockResolvedValue(mockResponse(200, { id: "g1", guildIds: [], createdAt: 0 }));
      await client.getGroup("sess-1", "g1");
      expect(urlOf(mockFetch.mock.calls[2])).toContain("/v4/sessions/sess-1/groups/g1");

      mockFetch.mockResolvedValue(mockResponse(200, { id: "g1", guildIds: [], createdAt: 0, players: [] }));
      await client.updateGroup("sess-1", "g1", { volume: 50, paused: true });
      const [updateUrl, updateInit] = mockFetch.mock.calls[3] as [string, RequestInit];
      expect(updateUrl).toContain("/groups/g1");
      expect(updateInit.method).toBe("PATCH");
      expect(JSON.parse(updateInit.body as string)).toEqual({ volume: 50, paused: true });

      mockFetch.mockResolvedValue(mockResponse(204, undefined));
      await client.deleteGroup("sess-1", "g1");
      expect((mockFetch.mock.calls[4] as any[])[1].method).toBe("DELETE");
    });
  });

  describe("updatePlayer NodeLink fields", () => {
    it("passes loudnessNormalizer, ducking, crossfade, fading and track language through", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await client.updatePlayer("sess-1", "12345678901234567", {
        track: { encoded: "AAA", audioTrackId: "2", language: "en" },
        loudnessNormalizer: true,
        ducking: true,
        crossfade: { enabled: true, duration: 5000 },
        fading: { enabled: true, trackStart: { duration: 500, curve: "linear", type: "volume" } },
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.track).toEqual({ encoded: "AAA", audioTrackId: "2", language: "en" });
      expect(body.loudnessNormalizer).toBe(true);
      expect(body.ducking).toBe(true);
      expect(body.crossfade).toEqual({ enabled: true, duration: 5000 });
      expect(body.fading.trackStart.type).toBe("volume");
    });
  });

  describe("youtube-source plugin", () => {
    it("GETs status from the server root (not under /v4)", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(200, { oauthEnabled: true }));

      const status = await client.getYouTubeStatus();

      expect(status).toEqual({ oauthEnabled: true });
      expect(urlOf(mockFetch.mock.calls[0])).toBe("http://localhost:2333/youtube");
      expect((mockFetch.mock.calls[0] as any[])[1].method).toBe("GET");
    });

    it("POSTs poToken + visitorData", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(204, undefined));

      await client.setYouTubePoToken("po-abc", "visitor-xyz");

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:2333/youtube");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        poToken: "po-abc",
        visitorData: "visitor-xyz",
      });
    });

    it("POSTs an OAuth refresh token (skipInitialization defaults true)", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(204, undefined));

      await client.setYouTubeRefreshToken("refresh-123");

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        refreshToken: "refresh-123",
        skipInitialization: true,
      });
    });

    it("starts the device-code flow when no refresh token is given", async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(mockResponse(204, undefined));

      await client.setYouTubeRefreshToken();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        refreshToken: null,
        skipInitialization: true,
      });
    });
  });
});
