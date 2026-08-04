import { describe, it, expect } from "vitest";
import { Track } from "./Track.ts";
import type { TrackData } from "../types/protocol.ts";

const mockTrackData: TrackData = {
  encoded: "encoded_data",
  info: {
    identifier: "dQw4w9WgXcQ",
    isSeekable: true,
    author: "RickAstleyVEVO",
    length: 212000,
    isStream: false,
    position: 0,
    title: "Never Gonna Give You Up",
    uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    isrc: "GBARL9300135",
    sourceName: "youtube",
  },
  pluginInfo: {},
};

describe("Track Aliases", () => {
  it("should return length same as info.length and duration", () => {
    const track = new Track(mockTrackData);
    expect(track.length).toBe(track.info.length);
    expect(track.length).toBe(track.duration);
    expect(track.length).toBe(212000);
  });

  it("should return source same as info.sourceName and sourceName", () => {
    const track = new Track(mockTrackData);
    expect(track.source).toBe(track.info.sourceName);
    expect(track.source).toBe(track.sourceName);
    expect(track.source).toBe("youtube");
  });

  it("should return artworkUrl same as info.artworkUrl and thumbnail", () => {
    const track = new Track(mockTrackData);
    expect(track.artworkUrl).toBe(track.info.artworkUrl);
    expect(track.artworkUrl).toBe(track.thumbnail);
    expect(track.artworkUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  });

  it("should return isrc same as info.isrc", () => {
    const track = new Track(mockTrackData);
    expect(track.isrc).toBe(track.info.isrc);
    expect(track.isrc).toBe("GBARL9300135");
  });
});
