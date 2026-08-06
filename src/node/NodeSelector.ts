import type { Node } from "./Node.ts";

/**
 * Interface for custom node load balancing selectors.
 */
export interface NodeSelector {
  /**
   * Selects an optimal connected node from the provided array for a guild.
   * @param nodes Available nodes list
   * @param guildId Target guild ID or identifier string
   */
  pick(nodes: Node[], guildId: string): Node | null;
}

/**
 * Selects nodes based on a specified region, falling back to a secondary selector.
 */
export class RegionSelector implements NodeSelector {
  private readonly region: string;
  private readonly fallback: NodeSelector;

  public constructor(region: string, fallback?: NodeSelector) {
    this.region = region;
    this.fallback = fallback ?? new LeastPenaltySelector();
  }

  public pick(nodes: Node[], guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    const regionalNodes = connected.filter((n) => n.config.region === this.region);
    
    if (regionalNodes.length > 0) {
      return this.fallback.pick(regionalNodes, guildId);
    }
    
    return this.fallback.pick(connected, guildId);
  }
}

/**
 * Selects the node with the fewest active audio players.
 */
export class LeastUsedSelector implements NodeSelector {
  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    let best = connected[0] as Node;
    let minPlayers = best.playerCount;

    for (let i = 1; i < connected.length; i++) {
      const node = connected[i] as Node;
      if (node.playerCount < minPlayers) {
        best = node;
        minPlayers = node.playerCount;
      }
    }

    return best;
  }
}

/**
 * Selects the node with the lowest overall calculated penalty score (CPU load, frame deficits, nulled frames).
 */
export class LeastPenaltySelector implements NodeSelector {
  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    let best = connected[0] as Node;
    let minPenalty = best.penalties.total;

    for (let i = 1; i < connected.length; i++) {
      const node = connected[i] as Node;
      const penalty = node.penalties.total;
      if (penalty < minPenalty) {
        best = node;
        minPenalty = penalty;
      }
    }

    return best;
  }
}

/**
 * Selects the node reporting the lowest CPU usage score.
 */
export class CpuUsageSelector implements NodeSelector {
  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    let best = connected[0] as Node;
    let minCpu = best.stats?.cpu.lavalinkLoad ?? Number.MAX_VALUE;

    for (let i = 1; i < connected.length; i++) {
      const node = connected[i] as Node;
      const cpu = node.stats?.cpu.lavalinkLoad ?? Number.MAX_VALUE;
      if (cpu < minCpu) {
        best = node;
        minCpu = cpu;
      }
    }

    return best;
  }
}

/**
 * Selects the node with the lowest memory usage.
 */
export class MemoryUsageSelector implements NodeSelector {
  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    let best = connected[0] as Node;
    let minUsed = best.stats?.memory.used ?? Number.MAX_VALUE;

    for (let i = 1; i < connected.length; i++) {
      const node = connected[i] as Node;
      const used = node.stats?.memory.used ?? Number.MAX_VALUE;
      if (used < minUsed) {
        best = node;
        minUsed = used;
      }
    }

    return best;
  }
}

/**
 * Selects the node with the lowest WebSocket round-trip ping.
 */
export class LowestPingSelector implements NodeSelector {
  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    let best = connected[0] as Node;
    let minPing = best.ping ?? Number.MAX_VALUE;

    for (let i = 1; i < connected.length; i++) {
      const node = connected[i] as Node;
      const ping = node.ping ?? Number.MAX_VALUE;
      if (ping < minPing) {
        best = node;
        minPing = ping;
      }
    }

    return best;
  }
}

/**
 * Cycles through connected nodes sequentially in round-robin fashion.
 */
export class RoundRobinSelector implements NodeSelector {
  private index = 0;

  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    this.index = this.index % connected.length;
    const selected = connected[this.index] as Node;
    this.index = (this.index + 1) % connected.length;

    return selected;
  }

  public reset(): void {
    this.index = 0;
  }
}

/**
 * Picks a connected node at random.
 */
export class RandomSelector implements NodeSelector {
  public pick(nodes: Node[], _guildId: string): Node | null {
    if (nodes.length === 0) return null;
    const connected = nodes.filter((n) => n.state === "connected" && !n.maintenance);
    if (connected.length === 0) return null;

    const index = Math.floor(Math.random() * connected.length);
    return connected[index] as Node;
  }
}

/**
 * Allows passing a custom selector function `(nodes: Node[], guildId: string) => Node | null`.
 */
export class CustomSelector implements NodeSelector {
  private readonly pickerFn: (nodes: Node[], guildId: string) => Node | null;

  public constructor(pickerFn: (nodes: Node[], guildId: string) => Node | null) {
    this.pickerFn = pickerFn;
  }

  public pick(nodes: Node[], guildId: string): Node | null {
    return this.pickerFn(nodes, guildId);
  }
}
