import { WebSocketClient } from "../ws/WebSocketClient.ts";
import { RestClient } from "../rest/RestClient.ts";
import type { NodeConfig, NodeState, NodeStats } from "../types/internal.ts";
import { EventDispatcher } from "../ws/EventDispatcher.ts";
import type { EventName, EventCallback } from "../types/internal.ts";
import { NodeStateCode } from "../types/constants.ts";

export type { NodeState };

/**
 * Calculated penalty score metrics for node load balancing.
 */
export interface PenaltyScore {
  total: number;
  playerPenalty: number;
  cpuPenalty: number;
  deficitPenalty: number;
  nullPenalty: number;
}

/**
 * Represents a single Lavalink v4 node connection, providing WS event subscriptions,
 * REST API client, and penalty score metrics.
 */
export class Node {
  public readonly config: NodeConfig;
  public readonly ws: WebSocketClient;
  public readonly rest: RestClient;
  private readonly events: EventDispatcher;
  private _stats: NodeStats | null = null;
  private _ping: number | null = null;
  private _penalties: PenaltyScore = {
    total: 0,
    playerPenalty: 0,
    cpuPenalty: 0,
    deficitPenalty: 0,
    nullPenalty: 0,
  };
  private _playerCount: number = 0;

  public constructor(config: NodeConfig, userId: string) {
    this.config = config;
    this.events = new EventDispatcher();

    this.rest = new RestClient({
      host: config.host,
      port: config.port,
      password: config.password,
      secure: config.secure,
      sessionId: config.resumeKey,
      retryOptions: {
        maxRetries: config.maxRetries ?? 3,
        baseDelay: config.retryDelay ?? 1000,
        maxDelay: config.retryDelayMax ?? 15000,
      },
    });

    this.ws = new WebSocketClient({
      nodeConfig: config,
      userId,
      clientName: "YuKumo/0.0.1",
    });

    this.ws.eventDispatcher.on("stats", (_nodeId: string, stats: NodeStats) => {
      this._stats = stats;
      this.updatePenalties();
    });

    this.ws.eventDispatcher.on("nodeReady", () => {
      if (this.ws.sessionId) {
        this.rest.sessionId = this.ws.sessionId;

        // Lavalink only honors Session-Id on reconnect if resuming was enabled beforehand
        if (config.resumeKey != null) {
          this.rest
            .updateSession(this.ws.sessionId, {
              resuming: true,
              timeout: config.resumeTimeout ?? 60,
            })
            .catch((error: unknown) => {
              this.events.emit(
                "debug",
                `Failed to enable session resuming on ${this.id}: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
        }
      }
    });

    this.ws.eventDispatcher.on("playerUpdate", (_guildId: string, state: { ping?: number }) => {
      if (state.ping != null && state.ping >= 0) {
        this._ping = state.ping;
      }
    });

    this.ws.eventDispatcher.on("debug", (message: string) => {
      this.events.emit("debug", message);
    });
  }

  /** Gets the node unique name or identifier */
  public get id(): string {
    return this.config.name ?? `${this.config.host}:${this.config.port}`;
  }

  /** Gets the node name */
  public get name(): string {
    return this.id;
  }

  /** Sets the Discord bot User ID for WebSocket handshake */
  public setUserId(userId: string): void {
    this.ws.setUserId(userId);
  }

  /**
   * Gets the current connection state of the node.
   * Delegates to the WebSocket so unexpected drops and auto-reconnects are reflected immediately.
   */
  public get state(): NodeState {
    return this.ws.state;
  }

  /** Gets the latest node statistics */
  public get stats(): NodeStats | null {
    return this._stats;
  }

  /** Gets the latest round-trip WebSocket ping in ms if available */
  public get ping(): number | null {
    return this._ping;
  }

  /** Boolean shorthand — true when node WebSocket is connected */
  public get connected(): boolean {
    return this.state === "connected";
  }

  /** Integer state code for migration compat (see NodeStateCode enum) */
  public get stateCode(): number {
    const map: Record<string, number> = {
      disconnected: NodeStateCode.DISCONNECTED,
      connecting: NodeStateCode.CONNECTING,
      connected: NodeStateCode.CONNECTED,
      destroyed: NodeStateCode.DESTROYED,
    };
    return map[this.state] ?? 0;
  }

  /** Gets the calculated penalty score */
  public get penalties(): PenaltyScore {
    return this._penalties;
  }

  /** Gets the active player count on this node */
  public get playerCount(): number {
    return this._playerCount;
  }

  /** Sets the active player count on this node */
  public set playerCount(count: number) {
    this._playerCount = count;
  }

  /** Gets the event dispatcher for node level events */
  public get eventDispatcher(): EventDispatcher {
    return this.events;
  }

  /** Subscribes to node events */
  public on<E extends EventName>(event: E, callback: EventCallback<E>): this {
    this.events.on(event, callback);
    return this;
  }

  private updatePenalties(): void {
    const stats = this._stats;
    if (stats === null) {
      this._penalties = { total: 0, playerPenalty: 0, cpuPenalty: 0, deficitPenalty: 0, nullPenalty: 0 };
      return;
    }

    const playerPenalty = stats.players;
    const cpuPenalty = Math.round(Math.pow(1.05, stats.cpu.lavalinkLoad * 100) * 10 - 10);
    const deficitPenalty =
      stats.frameStats != null ? Math.round(Math.pow(1.03, stats.frameStats.deficit) * 10 - 10) * 2 : 0;
    const nullPenalty =
      stats.frameStats != null ? Math.round(Math.pow(1.03, stats.frameStats.nulled) * 10 - 10) * 3 : 0;

    this._penalties = {
      total: playerPenalty + cpuPenalty + deficitPenalty + nullPenalty,
      playerPenalty,
      cpuPenalty,
      deficitPenalty,
      nullPenalty,
    };
  }

  /** Initiates WebSocket connection to the Lavalink node; resolves once the socket is open */
  public async connect(): Promise<void> {
    await this.ws.connect();
  }

  /** Closes the WebSocket connection */
  public async close(): Promise<void> {
    await this.ws.close();
  }

  /** Destroys the node instance and cleans up event listeners */
  public destroy(): void {
    this.ws.destroy();
    this.events.removeAllListeners();
  }
}
