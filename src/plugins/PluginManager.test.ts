import { describe, it, expect, vi } from "vitest";
import type { TrackData } from "../types/protocol.ts";
import type { SearchResult } from "../types/internal.ts";

function makeTrack(encoded: string): TrackData {
  return {
    encoded,
    info: {
      identifier: "",
      isSeekable: false,
      author: "",
      length: 0,
      isStream: false,
      position: 0,
      title: "",
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "",
    },
    pluginInfo: {},
  };
}
import { PluginManager } from "./PluginManager.ts";
import type { Plugin } from "./Plugin.ts";
import {
  createLavaSrcPlugin,
  createSponsorBlockPlugin,
  createFloweryTTSPlugin,
} from "./LavaPlugins.ts";

describe("server-plugin markers", () => {
  it("createLavaSrcPlugin records options and marks itself server-side", () => {
    const plugin = createLavaSrcPlugin({ spotify: { clientId: "abc" } });
    expect(plugin.name).toBe("lavasrc");
    expect(plugin.isServerPlugin).toBe(true);
    expect(plugin.options.spotify?.clientId).toBe("abc");
  });

  it("createSponsorBlockPlugin defaults options to an empty object", () => {
    const plugin = createSponsorBlockPlugin();
    expect(plugin.name).toBe("sponsorblock");
    expect(plugin.isServerPlugin).toBe(true);
    expect(plugin.options).toEqual({});
  });

  it("markers register in the PluginManager and carry no init side effect", async () => {
    const manager = new PluginManager();
    manager.register(createFloweryTTSPlugin({ voice: "default" }));
    await manager.ready();
    expect(manager.get("flowerytts")?.name).toBe("flowerytts");
  });
});

describe("PluginManager", () => {
  describe("register", () => {
    it("should register a plugin", () => {
      const manager = new PluginManager();
      const plugin: Plugin = { name: "test", version: "1.0.0" };
      manager.register(plugin);
      expect(manager.get("test")).toBe(plugin);
    });

    it("should throw if plugin already registered", () => {
      const manager = new PluginManager();
      const plugin: Plugin = { name: "test", version: "1.0.0" };
      manager.register(plugin);
      expect(() => manager.register(plugin)).toThrow('Plugin "test" is already registered');
    });

    it("should call init on registration if present", async () => {
      const manager = new PluginManager();
      const init = vi.fn();
      const plugin: Plugin = { name: "test", version: "1.0.0", init };
      manager.register(plugin);
      expect(init).toHaveBeenCalledTimes(1);
    });
  });

  describe("unregister", () => {
    it("should unregister a plugin", () => {
      const manager = new PluginManager();
      const plugin: Plugin = { name: "test", version: "1.0.0" };
      manager.register(plugin);
      expect(manager.unregister("test")).toBe(true);
      expect(manager.get("test")).toBeUndefined();
    });

    it("should return false for unregistered plugin", () => {
      const manager = new PluginManager();
      expect(manager.unregister("nonexistent")).toBe(false);
    });

    it("should call destroy on unregister if present", () => {
      const manager = new PluginManager();
      const destroy = vi.fn();
      const plugin: Plugin = { name: "test", version: "1.0.0", destroy };
      manager.register(plugin);
      manager.unregister("test");
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAll", () => {
    it("should return all registered plugins", () => {
      const manager = new PluginManager();
      const a: Plugin = { name: "a", version: "1.0.0" };
      const b: Plugin = { name: "b", version: "1.0.0" };
      manager.register(a);
      manager.register(b);
      expect(manager.getAll()).toEqual([a, b]);
    });
  });

  describe("startAll", () => {
    it("should call start on all plugins", async () => {
      const manager = new PluginManager();
      const startA = vi.fn();
      const startB = vi.fn();
      manager.register({ name: "a", version: "1.0.0", start: startA });
      manager.register({ name: "b", version: "1.0.0", start: startB });
      await manager.startAll();
      expect(startA).toHaveBeenCalledOnce();
      expect(startB).toHaveBeenCalledOnce();
    });

    it("should throw if a plugin fails to start", async () => {
      const manager = new PluginManager();
      manager.register({
        name: "faulty",
        version: "1.0.0",
        start: () => {
          throw new Error("boom");
        },
      });
      await expect(manager.startAll()).rejects.toThrow('Plugin "faulty" failed to start: boom');
    });
  });

  describe("destroyAll", () => {
    it("should call destroy on all plugins and clear", async () => {
      const manager = new PluginManager();
      const destroyA = vi.fn();
      const destroyB = vi.fn();
      manager.register({ name: "a", version: "1.0.0", destroy: destroyA });
      manager.register({ name: "b", version: "1.0.0", destroy: destroyB });
      await manager.destroyAll();
      expect(destroyA).toHaveBeenCalledOnce();
      expect(destroyB).toHaveBeenCalledOnce();
      expect(manager.getAll()).toEqual([]);
    });

    it("should not throw if a plugin destroy fails", async () => {
      const manager = new PluginManager();
      manager.register({
        name: "faulty",
        version: "1.0.0",
        destroy: () => {
          throw new Error("boom");
        },
      });
      await expect(manager.destroyAll()).resolves.toBeUndefined();
    });
  });

  describe("addHook / removeHook", () => {
    it("should add and execute a hook", async () => {
      const manager = new PluginManager();
      const handler = vi.fn(async (query: string) => ({ query, source: "ytsearch" }));
      manager.addHook("beforeSearch", handler);
      await manager.runBeforeSearch("test");
      expect(handler).toHaveBeenCalledWith("test", undefined);
    });

    it("should remove a hook", async () => {
      const manager = new PluginManager();
      const handler = vi.fn(async (query: string) => ({ query, source: "ytsearch" }));
      manager.addHook("beforeSearch", handler);
      manager.removeHook("beforeSearch", handler);
      const result = await manager.runBeforeSearch("test");
      expect(result).toEqual({ query: "test", source: undefined });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("beforeSearch", () => {
    it("should chain hooks and pass results through", async () => {
      const manager = new PluginManager();
      const h1 = vi.fn(async (_query: string) => ({ query: "modified", source: "ytsearch" }));
      manager.addHook("beforeSearch", h1);
      const result = await manager.runBeforeSearch("original");
      expect(result).toEqual({ query: "modified", source: "ytsearch" });
    });

    it("should return null if any hook returns null", async () => {
      const manager = new PluginManager();
      manager.addHook("beforeSearch", async () => null);
      const result = await manager.runBeforeSearch("test");
      expect(result).toBeNull();
    });
  });

  describe("afterSearch", () => {
    it("should chain hooks and pass results through", async () => {
      const manager = new PluginManager();
      const handler = vi.fn(async (result: SearchResult) => {
        return { ...result, tracks: [makeTrack("modified")] };
      });
      manager.addHook("afterSearch", handler);
      const input: SearchResult = { loadType: "track", tracks: [makeTrack("original")] };
      const result = await manager.runAfterSearch(input);
      expect(result).toEqual({ loadType: "track", tracks: [makeTrack("modified")] });
    });

    it("should return null if any hook returns null", async () => {
      const manager = new PluginManager();
      manager.addHook("afterSearch", async () => null);
      const input: SearchResult = { loadType: "track", tracks: [makeTrack("original")] };
      const result = await manager.runAfterSearch(input);
      expect(result).toBeNull();
    });
  });

  describe("beforeConnect", () => {
    it("should chain hooks and pass results through", async () => {
      const manager = new PluginManager();
      const h1 = vi.fn(async (_guildId: string, _channelId: string) => ({
        guildId: "modified-guild",
        channelId: "modified-channel",
      }));
      manager.addHook("beforeConnect", h1);
      const result = await manager.runBeforeConnect("guild", "channel");
      expect(result).toEqual({ guildId: "modified-guild", channelId: "modified-channel" });
    });

    it("should return null if any hook returns null", async () => {
      const manager = new PluginManager();
      manager.addHook("beforeConnect", async () => null);
      const result = await manager.runBeforeConnect("guild", "channel");
      expect(result).toBeNull();
    });
  });

  describe("afterConnect", () => {
    it("should call all hooks", async () => {
      const manager = new PluginManager();
      const handler = vi.fn(async () => {});
      manager.addHook("afterConnect", handler);
      await manager.runAfterConnect("guild", "channel");
      expect(handler).toHaveBeenCalledWith("guild", "channel");
    });
  });

  describe("beforePlay", () => {
    it("should chain hooks and pass track through", async () => {
      const manager = new PluginManager();
      const track = makeTrack("original");
      const h1 = vi.fn(async (_guildId: string, t: TrackData) => ({
        ...t,
        encoded: "modified",
      }));
      manager.addHook("beforePlay", h1);
      const result = await manager.runBeforePlay("guild", track);
      expect(result).toEqual({ ...track, encoded: "modified" });
    });

    it("should return null if any hook returns null", async () => {
      const manager = new PluginManager();
      manager.addHook("beforePlay", async () => null);
      const result = await manager.runBeforePlay("guild", makeTrack("test"));
      expect(result).toBeNull();
    });
  });

  describe("afterPlay", () => {
    it("should call all hooks", async () => {
      const manager = new PluginManager();
      const handler = vi.fn(async () => {});
      manager.addHook("afterPlay", handler);
      const track = makeTrack("test");
      await manager.runAfterPlay("guild", track);
      expect(handler).toHaveBeenCalledWith("guild", track);
    });
  });

  describe("beforeDestroy", () => {
    it("should chain hooks and return true if all pass", async () => {
      const manager = new PluginManager();
      manager.addHook("beforeDestroy", async () => true);
      const result = await manager.runBeforeDestroy("guild");
      expect(result).toBe(true);
    });

    it("should return false if any hook returns false", async () => {
      const manager = new PluginManager();
      manager.addHook("beforeDestroy", async () => true);
      manager.addHook("beforeDestroy", async () => false);
      const result = await manager.runBeforeDestroy("guild");
      expect(result).toBe(false);
    });
  });

  describe("afterDestroy", () => {
    it("should call all hooks", async () => {
      const manager = new PluginManager();
      const handler = vi.fn(async () => {});
      manager.addHook("afterDestroy", handler);
      await manager.runAfterDestroy("guild");
      expect(handler).toHaveBeenCalledWith("guild");
    });
  });

  describe("onNodeSelect", () => {
    it("should return the first non-null result", async () => {
      const manager = new PluginManager();
      manager.addHook("onNodeSelect", async () => null);
      manager.addHook("onNodeSelect", async () => "node-b");
      const result = await manager.runOnNodeSelect("guild", ["node-a", "node-b"]);
      expect(result).toBe("node-b");
    });

    it("should return null if no hook returns a node", async () => {
      const manager = new PluginManager();
      manager.addHook("onNodeSelect", async () => null);
      const result = await manager.runOnNodeSelect("guild", ["node-a"]);
      expect(result).toBeNull();
    });
  });
});
