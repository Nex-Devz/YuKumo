import { Node } from "./Node.ts";
import type { NodeSelector } from "./NodeSelector.ts";
import { LeastUsedSelector } from "./NodeSelector.ts";
import type { NodeConfig } from "../types/internal.ts";
import type { NodeFeature } from "./capabilities.ts";
import { YukumoUnsupportedFeatureError } from "../errors/index.ts";

export class NodeManager {
  private readonly nodes = new Map<string, Node>();
  private userId: string;
  private selector: NodeSelector;

  public constructor(userId: string, selector?: NodeSelector) {
    this.userId = userId;
    this.selector = selector ?? new LeastUsedSelector();
  }

  public setUserId(userId: string): void {
    this.userId = userId;
    for (const node of this.nodes.values()) {
      node.setUserId(userId);
    }
  }

  public setSelector(selector: NodeSelector): void {
    this.selector = selector;
  }

  public add(config: NodeConfig): Node {
    const id = config.name ?? `${config.host}:${config.port}`;
    if (this.nodes.has(id)) {
      throw new Error(`Node "${id}" already exists`);
    }

    const node = new Node(config, this.userId);
    this.nodes.set(id, node);
    return node;
  }

  public remove(id: string): boolean {
    const node = this.nodes.get(id);
    if (node === undefined) return false;

    node.destroy();
    this.nodes.delete(id);
    return true;
  }

  public get(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  public getAll(): Node[] {
    return Array.from(this.nodes.values());
  }

  public getConnected(): Node[] {
    return this.getAll().filter((n) => n.state === "connected");
  }

  public async connectAll(): Promise<void> {
    const promises = Array.from(this.nodes.values()).map((node) =>
      node.connect().catch(() => {
        // individual node failures are handled via events
      }),
    );
    await Promise.all(promises);
  }

  public async destroyAll(): Promise<void> {
    const nodes = this.getAll();
    this.nodes.clear();
    await Promise.all(nodes.map((n) => n.close()));
  }

  /**
   * Picks a node for a guild via the active selector. When `opts.feature` is
   * given, only nodes that support that feature are considered — so a
   * NodeLink-only request (lyrics, chapters, voice receive, …) never lands on a
   * plain Lavalink node. Throws {@link YukumoUnsupportedFeatureError} when no
   * connected node supports the requested feature.
   */
  public pick(guildId: string, opts?: { feature?: NodeFeature }): Node | null {
    const feature = opts?.feature;
    if (feature == null) {
      return this.selector.pick(this.getAll(), guildId);
    }

    const capable = this.getAll().filter((n) => n.supports(feature));
    if (capable.length === 0) {
      // Distinguish "no capable node" from "no node at all" with a clear error
      // only when there are nodes but none qualify; empty pool returns null.
      if (this.getConnected().length === 0) return null;
      throw new YukumoUnsupportedFeatureError(feature, "<pool>", "mixed");
    }
    return this.selector.pick(capable, guildId);
  }

  public size(): number {
    return this.nodes.size;
  }

  /** Gets number of registered nodes (getter alias) */
  public get count(): number {
    return this.nodes.size;
  }

  /**
   * Iterate over all nodes
   */
  public [Symbol.iterator](): IterableIterator<Node> {
    return this.nodes.values();
  }

  /**
   * String tag for NodeManager
   */
  public get [Symbol.toStringTag](): string {
    return "NodeManager";
  }

  /**
   * Check if any node satisfies the condition
   */
  public some(fn: (node: Node) => boolean): boolean {
    return Array.from(this.nodes.values()).some(fn);
  }

  /**
   * Check if all nodes satisfy the condition
   */
  public every(fn: (node: Node) => boolean): boolean {
    return Array.from(this.nodes.values()).every(fn);
  }

  /**
   * Filter nodes by condition
   */
  public filter(fn: (node: Node) => boolean): Node[] {
    return Array.from(this.nodes.values()).filter(fn);
  }

  /**
   * Map nodes to a new array
   */
  public map<U>(fn: (node: Node) => U): U[] {
    return Array.from(this.nodes.values()).map(fn);
  }

  /**
   * Find first node satisfying the condition
   */
  public find(fn: (node: Node) => boolean): Node | undefined {
    return Array.from(this.nodes.values()).find(fn);
  }

  /**
   * Iterate over all nodes
   */
  public forEach(fn: (node: Node, index: number) => void): void {
    Array.from(this.nodes.values()).forEach(fn);
  }

  /**
   * Reduce nodes to a single value
   */
  public reduce<U>(fn: (acc: U, node: Node) => U, initial: U): U {
    return Array.from(this.nodes.values()).reduce(fn, initial);
  }

  /**
   * Get an iterable iterator of all nodes
   */
  public values(): IterableIterator<Node> {
    return this.nodes.values();
  }

  /**
   * Get an iterable iterator of node keys
   */
  public keys(): IterableIterator<string> {
    return this.nodes.keys();
  }

  /**
   * Get an iterable iterator of node entries
   */
  public entries(): IterableIterator<[string, Node]> {
    return this.nodes.entries();
  }

  /**
   * Get a Map of all nodes
   */
  public get nodeMap(): Map<string, Node> {
    return new Map(this.nodes);
  }

  /**
   * Get least used node
   */
  public getLeastUsed(): Node | null {
    const selector = new LeastUsedSelector();
    return selector.pick(this.getAll(), "");
  }
}
