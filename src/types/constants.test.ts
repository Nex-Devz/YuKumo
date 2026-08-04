import { describe, it, expect } from "vitest";
import { NodeStateCode, LoopMode, LoadTypeMap } from "./constants.ts";

describe("Constants", () => {
  it("should have correct NodeStateCode values", () => {
    expect(NodeStateCode.DISCONNECTED).toBe(0);
    expect(NodeStateCode.CONNECTING).toBe(1);
    expect(NodeStateCode.CONNECTED).toBe(2);
    expect(NodeStateCode.DESTROYED).toBe(3);
  });

  it("should have correct LoopMode values", () => {
    expect(LoopMode.NONE).toBe("none");
    expect(LoopMode.TRACK).toBe("track");
    expect(LoopMode.QUEUE).toBe("queue");
  });

  it("should map LoadTypeMap correctly", () => {
    expect(LoadTypeMap.track).toBe("TRACK_LOADED");
    expect(LoadTypeMap.playlist).toBe("PLAYLIST_LOADED");
    expect(LoadTypeMap.search).toBe("SEARCH_RESULT");
    expect(LoadTypeMap.empty).toBe("NO_MATCHES");
    expect(LoadTypeMap.error).toBe("LOAD_FAILED");
  });
});
