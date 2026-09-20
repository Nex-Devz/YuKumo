import { describe, it, expect } from "vitest";
import { parseLrc } from "./Lyrics.ts";
import { SponsorBlockClient } from "./SponsorBlock.ts";

describe("Lyrics & SponsorBlock Integration", () => {
  describe("parseLrc", () => {
    it("should correctly parse timestamped LRC strings", () => {
      const lrc = "[00:12.50] Intro line\n[01:05.00] Chorus line";
      const parsed = parseLrc(lrc);

      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({ timestampMs: 12500, text: "Intro line" });
      expect(parsed[1]).toEqual({ timestampMs: 65000, text: "Chorus line" });
    });

    it("should handle empty or malformed input gracefully", () => {
      expect(parseLrc("")).toEqual([]);
      expect(parseLrc("Just plain text without timestamps")).toEqual([]);
    });
  });

  describe("SponsorBlockClient", () => {
    it("should find target skip position when in sponsor range", () => {
      const client = new SponsorBlockClient();
      const segments = [{ UUID: "seg-1", category: "sponsor" as const, startMs: 10000, endMs: 25000 }];

      // At position 15000ms (inside segment) -> skip target is 25000ms
      expect(client.getSkipPosition(15000, segments)).toBe(25000);

      // Outside segment -> null
      expect(client.getSkipPosition(5000, segments)).toBeNull();
      expect(client.getSkipPosition(30000, segments)).toBeNull();
    });
  });
});
