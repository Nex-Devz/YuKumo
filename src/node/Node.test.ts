import { describe, it, expect, vi } from "vitest";
import { Node } from "./Node.ts";
import type { NodeStats } from "../types/internal.ts";

function createNode(isNodeLink?: boolean, name = "test-node", resuming = false, resumeKey?: string): Node {
  const node = new Node(
    {
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      name,
      resuming,
      resumeKey,
      ...(isNodeLink !== undefined ? { isNodeLink } : {}),
    },
    "123456",
  );
  return node;
}

function emitStats(node: Node, stats: Partial<NodeStats>): void {
  node.ws.eventDispatcher.emit("stats", node.id, {
    players: 0,
    playingPlayers: 0,
    uptime: 0,
    memory: { free: 0, used: 0, allocated: 0, reservable: 0 },
    cpu: { cores: 1, systemLoad: 0 },
    frameStats: null,
    ...stats,
  });
}

describe("Node penalties", () => {
  it("computes penalties from cpu.lavalinkLoad (Lavalink)", () => {
    const node = createNode(false);
    emitStats(node, { cpu: { cores: 4, systemLoad: 0.5, lavalinkLoad: 0.2 } });

    expect(node.penalties.cpuPenalty).toBeGreaterThan(0);
    expect(Number.isFinite(node.penalties.total)).toBe(true);
  });

  it("computes penalties from cpu.nodelinkLoad (NodeLink)", () => {
    const node = createNode(true);
    emitStats(node, { cpu: { cores: 4, systemLoad: 0.5, nodelinkLoad: 0.4 } });

    expect(node.penalties.cpuPenalty).toBeGreaterThan(0);
    expect(Number.isFinite(node.penalties.total)).toBe(true);
  });

  it("never produces NaN when the CPU load metric is missing", () => {
    const node = createNode(true);
    // NodeLink stats come with no lavalinkLoad; if nodelinkLoad is also absent
    emitStats(node, { cpu: { cores: 2, systemLoad: 0.1 } });

    expect(Number.isNaN(node.penalties.cpuPenalty)).toBe(false);
    expect(Number.isNaN(node.penalties.total)).toBe(false);
    expect(node.penalties.cpuPenalty).toBe(0);
  });

  it("handles frameStats from NodeLink (with expected field)", () => {
    const node = createNode(true);
    emitStats(node, {
      frameStats: { sent: 100, nulled: 2, deficit: -1, expected: 110 },
    });

    expect(node.penalties.nullPenalty).toBeGreaterThan(0);
    expect(Number.isFinite(node.penalties.total)).toBe(true);
  });
});

describe("Node session resuming", () => {
  it("enables resuming for NodeLink nodes too", async () => {
    const node = createNode(true, "test-node", true);
    node.rest.getInfo = vi.fn().mockResolvedValue({ isNodelink: true });
    node.rest.updateSession = vi.fn().mockResolvedValue({ resuming: true, timeout: 60 });

    Object.defineProperty(node.ws, "sessionId", { value: "sess-1", writable: true });

    node.ws.eventDispatcher.emit("nodeReady", node.id);

    await vi.waitFor(() => {
      expect(node.rest.updateSession).toHaveBeenCalledWith("sess-1", { resuming: true, timeout: 60 });
    });
  });

  it("skips resuming when not configured", async () => {
    const node = createNode(false);
    node.rest.getInfo = vi.fn().mockResolvedValue({ version: "4.0.7" });
    node.rest.updateSession = vi.fn().mockResolvedValue({ resuming: false, timeout: 0 });
    Object.defineProperty(node.ws, "sessionId", { value: "sess-1", writable: true });

    node.ws.eventDispatcher.emit("nodeReady", node.id);

    await new Promise((r) => setTimeout(r, 20));
    expect(node.rest.updateSession).not.toHaveBeenCalled();
  });

  it("detects NodeLink from /v4/info and marks the rest client", async () => {
    const node = createNode(undefined);
    node.rest.getInfo = vi.fn().mockResolvedValue({ isNodelink: true });
    Object.defineProperty(node.ws, "sessionId", { value: "sess-1", writable: true });

    node.ws.eventDispatcher.emit("nodeReady", node.id);

    await vi.waitFor(() => {
      expect(node.isNodeLink).toBe(true);
      expect(node.rest.isNodeLink).toBe(true);
    });
  });
});

describe("Node type, version & capabilities", () => {
  function readyWithInfo(node: Node, info: Record<string, unknown>): Promise<void> {
    node.rest.getInfo = vi.fn().mockResolvedValue(info);
    Object.defineProperty(node.ws, "sessionId", { value: "sess-1", writable: true });
    node.ws.eventDispatcher.emit("nodeReady", node.id);
    return vi.waitFor(() => {
      expect(node.capabilities).not.toBeNull();
    });
  }

  it("resolves type/version/capabilities from a NodeLink /v4/info", async () => {
    const node = createNode(undefined);
    await readyWithInfo(node, {
      isNodelink: true,
      version: { semver: "3.10.0" },
      filters: ["volume", "equalizer", "echo", "reverb"],
      sourceManagers: ["youtube", "soundcloud", "bandcamp"],
    });

    expect(node.type).toBe("nodelink");
    expect(node.version).toBe("3.10.0");
    expect(node.supports("lyrics")).toBe(true);
    expect(node.supports("voiceReceive")).toBe(true);
    expect(node.supports("extraFilters")).toBe(true);
    expect(node.supportsFilter("echo")).toBe(true);
    expect(node.supportsFilter("reverb")).toBe(true);
    expect(node.sourceManagers).toContain("bandcamp");
  });

  it("a Lavalink node reports no NodeLink-only features or extra filters", async () => {
    const node = createNode(undefined);
    await readyWithInfo(node, {
      version: "4.0.7",
      filters: ["volume", "equalizer", "karaoke"],
      sourceManagers: ["youtube"],
    });

    expect(node.type).toBe("lavalink");
    expect(node.version).toBe("4.0.7");
    expect(node.supports("lyrics")).toBe(false);
    expect(node.supports("voiceReceive")).toBe(false);
    expect(node.supports("extraFilters")).toBe(false);
    expect(node.supports("routeplanner")).toBe(true);
    expect(node.supportsFilter("timescale")).toBe(true); // standard always present
    expect(node.supportsFilter("echo")).toBe(false); // NodeLink-only
  });

  it("assertSupports throws YukumoUnsupportedFeatureError for missing features", async () => {
    const node = createNode(false);
    await readyWithInfo(node, { version: "4.0.7", filters: [], sourceManagers: [] });

    expect(() => node.assertSupports("voiceReceive")).toThrowError(
      /does not support the "voiceReceive" feature/,
    );
  });

  it("respects a forced type before /v4/info is consulted", () => {
    const nl = new Node({ host: "h", port: 1, password: "p", name: "nl", type: "nodelink" }, "1");
    expect(nl.type).toBe("nodelink");
    expect(nl.supports("lyrics")).toBe(true);

    const ll = new Node({ host: "h", port: 2, password: "p", name: "ll", type: "lavalink" }, "1");
    expect(ll.type).toBe("lavalink");
    expect(ll.supports("lyrics")).toBe(false);
  });
});
