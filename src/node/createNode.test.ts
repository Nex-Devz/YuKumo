import { describe, it, expect } from "vitest";
import { createNodeLinkNode, createLavalinkNode } from "./createNode.ts";

describe("createNodeLinkNode / createLavalinkNode", () => {
  it("createNodeLinkNode forces type nodelink and defaults resuming on", () => {
    const cfg = createNodeLinkNode({ host: "localhost", port: 2333, password: "pw" });
    expect(cfg.type).toBe("nodelink");
    expect(cfg.resuming).toBe(true);
    expect(cfg.host).toBe("localhost");
  });

  it("createLavalinkNode forces type lavalink", () => {
    const cfg = createLavalinkNode({ host: "h", port: 1, password: "p" });
    expect(cfg.type).toBe("lavalink");
    expect(cfg.resuming).toBe(true);
  });

  it("lets an explicit resuming override the default", () => {
    const cfg = createNodeLinkNode({ host: "h", port: 1, password: "p", resuming: false });
    expect(cfg.resuming).toBe(false);
    expect(cfg.type).toBe("nodelink");
  });
});
