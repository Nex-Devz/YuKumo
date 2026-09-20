import type { NodeConfig } from "../types/internal.ts";

/**
 * Builds a {@link NodeConfig} for a NodeLink server with sensible defaults:
 * `type: "nodelink"` (skips auto-detection) and session resuming enabled so a
 * restart reclaims the live session gap-free.
 *
 * @example
 * const kumo = new YuKumo({ nodes: [createNodeLinkNode({ host: "localhost", port: 2333, password: "pw" })] });
 */
export function createNodeLinkNode(
  config: Omit<NodeConfig, "type" | "isNodeLink"> & { resuming?: boolean },
): NodeConfig {
  return {
    resuming: true,
    ...config,
    type: "nodelink",
  };
}

/**
 * Builds a {@link NodeConfig} for a Lavalink v4 server with sensible defaults
 * (`type: "lavalink"`, session resuming enabled). Mirror of
 * {@link createNodeLinkNode} for symmetry when composing a mixed pool.
 */
export function createLavalinkNode(
  config: Omit<NodeConfig, "type" | "isNodeLink"> & { resuming?: boolean },
): NodeConfig {
  return {
    resuming: true,
    ...config,
    type: "lavalink",
  };
}
