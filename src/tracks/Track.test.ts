import { describe, it, expect } from "vitest";
import { Track, UnresolvedTrack, Playlist } from "./Track.ts";
import type { TrackData } from "../types/protocol.ts";

const mockTrackData: TrackData = {
  encoded:
    "QAAAjQIAJVJpY2sgQXN0bGV5IC0gTmV2ZXIgR29ubmEgR2l2ZSBZb3UgVXAADlJpY2tBc3RsZXlWRVZPAAAAAAADPCAAC2RRdzR3OVdnWGNRAAEAK2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9ZFF3NHc5V2dYY1EAB3lvdXR1YmUAAAAAAAAAAA==",
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
    isrc: null,
    sourceName: "youtube",
  },
  pluginInfo: {},
};

describe("Track", () => {
  it("should create from TrackData", () => {
    const track = new Track(mockTrackData);
    expect(track.encoded).toBe(mockTrackData.encoded);
    expect(track.title).toBe("Never Gonna Give You Up");
    expect(track.author).toBe("RickAstleyVEVO");
    expect(track.duration).toBe(212000);
  });

  it("should hold requester", () => {
    const requester = { id: "user-1" };
    const track = new Track(mockTrackData, requester);
    expect(track.requester).toBe(requester);
  });

  it("keeps requester through toJSON round-trip and JSON persistence", () => {
    const requester = { id: "user-1" };
    const track = Track.from(mockTrackData, requester);

    const serialized = track.toJSON();
    const restored = Track.from(serialized);
    expect(restored.requester).toEqual(requester);

    // survives JSON.stringify too (e.g. Player saveState → storage)
    const viaJson = Track.from(JSON.parse(JSON.stringify(track)));
    expect(viaJson.requester).toEqual(requester);
  });

  it("should format duration", () => {
    const track = new Track(mockTrackData);
    expect(track.durationFormatted).toBe("3:32");
  });

  it("should format duration with hours", () => {
    const data = {
      ...mockTrackData,
      info: { ...mockTrackData.info, length: 3661000 },
    };
    const track = new Track(data);
    expect(track.durationFormatted).toBe("1:01:01");
  });

  it("should expose helper getters", () => {
    const track = new Track(mockTrackData);
    expect(track.identifier).toBe("dQw4w9WgXcQ");
    expect(track.uri).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(track.thumbnail).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(track.isStream).toBe(false);
    expect(track.isSeekable).toBe(true);
    expect(track.sourceName).toBe("youtube");
  });

  it("should convert to JSON", () => {
    const track = new Track(mockTrackData);
    const json = track.toJSON();
    expect(json.encoded).toBe(mockTrackData.encoded);
    expect(json.info.title).toBe("Never Gonna Give You Up");
  });

  it("should create via static from()", () => {
    const track = Track.from(mockTrackData, { id: "user-1" });
    expect(track).toBeInstanceOf(Track);
    expect(track.requester).toEqual({ id: "user-1" });
  });

  it("should store userData as metadata", () => {
    const data = {
      ...mockTrackData,
      userData: { playedBy: "bot" },
    };
    const track = new Track(data);
    expect(track.metadata).toEqual({ playedBy: "bot" });
  });
});

describe("UnresolvedTrack", () => {
  it("should create with identifier", () => {
    const ut = new UnresolvedTrack("some query");
    expect(ut.identifier).toBe("some query");
  });

  it("should build query with source prefix", () => {
    const ut = new UnresolvedTrack("hello", { source: "yt" });
    expect(ut.toQuery()).toBe("ytsearch:hello");
  });

  it("should not add prefix when identifier already has colon", () => {
    const ut = new UnresolvedTrack("ytsearch:hello");
    expect(ut.toQuery()).toBe("ytsearch:hello");
  });

  it("should resolve to Track", () => {
    const ut = new UnresolvedTrack("test", { requester: { id: "user-1" } });
    const track = ut.resolve(Track.from(mockTrackData));

    expect(track).toBeInstanceOf(Track);
    expect(track.requester).toEqual({ id: "user-1" });
    expect(track.title).toBe("Never Gonna Give You Up");
  });
});

describe("Playlist", () => {
  it("should create with tracks", () => {
    const tracks = [Track.from(mockTrackData), Track.from(mockTrackData)];
    const playlist = new Playlist({ name: "Test Playlist", tracks });

    expect(playlist.name).toBe("Test Playlist");
    expect(playlist.size).toBe(2);
  });

  it("should calculate total duration", () => {
    const tracks = [new Track(mockTrackData), new Track(mockTrackData)];
    const playlist = new Playlist({ name: "Test", tracks });
    expect(playlist.duration).toBe(424000);
  });

  it("should return selected track", () => {
    const tracks = [Track.from(mockTrackData), Track.from(mockTrackData)];
    const playlist = new Playlist({ name: "Test", tracks, selectedTrack: 1 });
    expect(playlist.selected).toBe(tracks[1]);
  });

  it("should return null when selectedTrack is out of range", () => {
    const tracks = [Track.from(mockTrackData)];
    const playlist = new Playlist({
      name: "Test",
      tracks,
      selectedTrack: 5,
    });
    expect(playlist.selected).toBeNull();
  });

  it("should return null when selectedTrack is -1", () => {
    const tracks = [Track.from(mockTrackData)];
    const playlist = new Playlist({ name: "Test", tracks });
    expect(playlist.selected).toBeNull();
  });
});
