import WebSocket from "ws";
import type { ReadyOp, PlayerUpdateOp, StatsOp, IncomingEvent } from "../types/protocol.ts";
import { OP_CODES } from "../types/protocol.ts";
import type { NodeConfig, NodeStats, EventName } from "../types/internal.ts";
import { EventDispatcher } from "./EventDispatcher.ts";

export type WebSocketState = "disconnected" | "connecting" | "connected" | "destroyed";

export interface WebSocketClientOptions {
  nodeConfig: NodeConfig;
  userId: string;
  clientName: string;
}

export class WebSocketClient {
  private readonly options: WebSocketClientOptions;
  private readonly events: EventDispatcher;
  private ws: WebSocket | null = null;
  private _state: WebSocketState = "disconnected";
  private _sessionId: string | null = null;
  private _resumed: boolean = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyRequested = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _isAlive = true;

  public constructor(options: WebSocketClientOptions) {
    this.options = options;
    this.events = new EventDispatcher();
  }

  public setUserId(userId: string): void {
    this.options.userId = userId;
  }

  public get state(): WebSocketState {
    return this._state;
  }

  public get sessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Seeds a session ID before connect() so the Session-Id header is sent on the
   * first connection attempt — used to reclaim a persisted Lavalink session
   * after a full bot restart.
   */
  public setSessionId(id: string | null): void {
    this._sessionId = id;
  }

  public get resumed(): boolean {
    return this._resumed;
  }

  /** False when the last heartbeat ping went unanswered — the connection is presumed dead */
  public get isAlive(): boolean {
    return this._isAlive;
  }

  public get eventDispatcher(): EventDispatcher {
    return this.events;
  }

  public on<E extends EventName>(event: E, callback: (...args: unknown[]) => void): this {
    this.events.on(event, callback as never);
    return this;
  }

  public once<E extends EventName>(event: E, callback: (...args: unknown[]) => void): this {
    this.events.once(event, callback as never);
    return this;
  }

  public off<E extends EventName>(event: E, callback?: (...args: unknown[]) => void): this {
    this.events.off(event, callback as never);
    return this;
  }

  /** Node identifier used in emitted events: configured name, falling back to host:port */
  private get nodeId(): string {
    const { name, host, port } = this.options.nodeConfig;
    return name ?? `${host}:${port}`;
  }

  private get reconnectDelay(): number {
    const { maxRetries = 5, retryDelay = 1000, retryDelayMax = 30000 } = this.options.nodeConfig;
    if (this.reconnectAttempts >= maxRetries) {
      return -1;
    }
    const base = Math.min(retryDelay * 2 ** this.reconnectAttempts, retryDelayMax);
    // Half-jitter: avoids synchronized reconnect waves across nodes/shards
    return base / 2 + Math.random() * (base / 2);
  }

  public async connect(): Promise<void> {
    if (this._state === "destroyed") {
      throw new Error("Cannot connect: WebSocket client is destroyed");
    }

    if (this._state === "connecting" || this._state === "connected") {
      return;
    }

    this._state = "connecting";
    this.destroyRequested = false;

    const {
      host,
      port,
      password,
      secure,
      resumeKey,
      resuming,
      connectTimeout = 15000,
    } = this.options.nodeConfig;
    const protocol = secure === true ? "wss" : "ws";
    const url = `${protocol}://${host}:${port}/v4/websocket`;

    const headers: Record<string, string> = {
      ...this.options.nodeConfig.httpHeaders,
      // Auth/identity headers last — custom headers must not override them
      Authorization: password,
      "User-Id": this.options.userId,
      "Client-Name": this.options.clientName,
    };

    if ((resumeKey != null || resuming === true) && this._sessionId != null) {
      headers["Session-Id"] = this._sessionId;
    }

    const WSClass =
      typeof globalThis.WebSocket !== "undefined" && (globalThis.WebSocket as any)._isMockFunction
        ? globalThis.WebSocket
        : WebSocket;

    const instance = new (WSClass as any)(url, { headers });
    this.ws = instance;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Connection to ${host}:${port} timed out after ${connectTimeout}ms`));
        }
      }, connectTimeout);
      // Don't keep the process alive just for the connect timeout
      (timer as { unref?: () => void }).unref?.();

      const handleOpen = () => {
        const wasReconnect = this.reconnectAttempts > 0;
        this._state = "connected";
        this.reconnectAttempts = 0;
        this._isAlive = true;
        this.startHeartbeat(instance);
        this.events.emit("debug", `WebSocket connected to ${host}:${port}`);
        if (wasReconnect) {
          this.events.emit("nodeReconnected", this.nodeId);
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };

      const handleMsg = (event: any) => {
        const data =
          typeof event === "string" || Buffer.isBuffer(event)
            ? event.toString()
            : event?.data != null
              ? String(event.data)
              : String(event);
        this.handleMessage(data);
      };

      const handleClose = (event: any) => {
        const code = typeof event === "number" ? event : (event?.code ?? 1000);
        const reason = event?.reason != null ? String(event.reason) : "";
        this._state = "disconnected";
        this.stopHeartbeat();
        this.events.emit("debug", `WebSocket closed: code=${code} reason=${reason}`);
        this.events.emit("nodeDisconnected", this.nodeId, code, reason);

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`WebSocket to ${host}:${port} closed before opening: code=${code}`));
        }

        if (!this.destroyRequested) {
          this.scheduleReconnect();
        }
      };

      const handleError = (err: any) => {
        const error =
          err instanceof Error ? err : new Error(String(err?.message ?? err ?? "WebSocket error"));
        this.events.emit("debug", `WebSocket error on ${host}:${port}: ${error.message}`);
        this.events.emit("nodeError", this.nodeId, error);
        // The ws implementation emits "close" after "error"; rejection happens there
      };

      // Register through exactly one mechanism — dual registration would parse and
      // dispatch every message twice and double-run reconnect bookkeeping
      if (typeof instance.on === "function") {
        instance.on("open", handleOpen);
        instance.on("message", (data: any) => handleMsg(data));
        instance.on("close", (code: number, reason: any) => handleClose({ code, reason }));
        instance.on("error", (err: any) => handleError(err));
      } else {
        instance.onopen = handleOpen;
        instance.onmessage = handleMsg;
        instance.onclose = handleClose;
        instance.onerror = handleError;
      }
    });
  }

  private handleMessage(data: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      this.events.emit("debug", "Failed to parse WebSocket message");
      return;
    }

    const op = parsed.op as string;

    switch (op) {
      case OP_CODES.READY: {
        const payload = parsed as unknown as ReadyOp;
        this._sessionId = payload.sessionId;
        this._resumed = payload.resumed;
        this.events.emit(
          "debug",
          `Received ready: resumed=${payload.resumed} sessionId=${payload.sessionId}`,
        );

        this.events.emit("nodeReady", this.nodeId);
        break;
      }

      case OP_CODES.PLAYER_UPDATE: {
        const payload = parsed as unknown as PlayerUpdateOp;
        this.events.emit("playerUpdate", payload.guildId, payload.state);
        break;
      }

      case OP_CODES.STATS: {
        const payload = parsed as unknown as StatsOp;
        const stats: NodeStats = {
          players: payload.players,
          playingPlayers: payload.playingPlayers,
          uptime: payload.uptime,
          memory: payload.memory,
          cpu: payload.cpu,
          frameStats: payload.frameStats,
        };

        this.events.emit("stats", this.nodeId, stats);
        break;
      }

      case OP_CODES.EVENT: {
        const payload = parsed as unknown as IncomingEvent;
        this.handleEvent(payload);
        break;
      }

      default: {
        this.events.emit("debug", `Unknown op code: ${op}`);
      }
    }
  }

  private handleEvent(event: IncomingEvent): void {
    const guildId = event.guildId;

    switch (event.type) {
      case "TrackStartEvent": {
        this.events.emit("trackStart", guildId, event.track);
        break;
      }
      case "TrackEndEvent": {
        this.events.emit("trackEnd", guildId, event.track, event.reason);
        break;
      }
      case "TrackExceptionEvent": {
        this.events.emit("trackException", guildId, event.track, event.exception);
        break;
      }
      case "TrackStuckEvent": {
        this.events.emit("trackStuck", guildId, event.track, event.thresholdMs);
        break;
      }
      case "WebSocketClosedEvent": {
        this.events.emit(
          "debug",
          `Voice WebSocket closed: guild=${guildId} code=${event.code} reason=${event.reason}`,
        );
        this.events.emit("socketClosed", guildId, event.code, event.reason, event.byRemote);
        break;
      }
      default: {
        this.handlePluginEvent(event as unknown as Record<string, unknown>, guildId);
      }
    }
  }

  /**
   * Events emitted by Lavalink server plugins (SponsorBlock, LavaLyrics) —
   * not part of the core v4 protocol, so they arrive as "unknown" types.
   */
  private handlePluginEvent(event: Record<string, unknown>, guildId: string): void {
    switch (event.type) {
      // "SponsorBlock…" variants are NodeLink's names for the same events
      case "SegmentsLoaded":
      case "SponsorBlockSegmentsLoadedEvent": {
        this.events.emit("segmentsLoaded", guildId, (event.segments as unknown[]) ?? []);
        break;
      }
      case "SegmentSkipped":
      case "SponsorBlockSegmentSkippedEvent": {
        this.events.emit("segmentSkipped", guildId, event.segment);
        break;
      }
      case "ChaptersLoaded": {
        this.events.emit("chaptersLoaded", guildId, (event.chapters as unknown[]) ?? []);
        break;
      }
      case "ChapterStarted": {
        this.events.emit("chapterStarted", guildId, event.chapter);
        break;
      }
      case "LyricsFoundEvent": {
        this.events.emit("lyricsFound", guildId, event.lyrics);
        break;
      }
      case "LyricsNotFoundEvent": {
        this.events.emit("lyricsNotFound", guildId);
        break;
      }
      case "LyricsLineEvent": {
        this.events.emit("lyricsLine", guildId, event.line ?? event);
        break;
      }
      // NodeLink audio mixer events
      case "MixStartedEvent": {
        this.events.emit("mixStarted", guildId, event);
        break;
      }
      case "MixEndedEvent": {
        this.events.emit("mixEnded", guildId, event);
        break;
      }
      default: {
        this.events.emit("debug", `Unknown event type: ${String(event.type)}`);
      }
    }
  }

  /**
   * WS-level heartbeat: ping the node on an interval and require a pong within
   * the timeout. Half-open TCP connections (node crashed, network dropped)
   * otherwise look "connected" forever and silently swallow every payload.
   * Only active when the socket implementation exposes ping() (the ws package).
   */
  private startHeartbeat(instance: any): void {
    const {
      enableHeartbeat = true,
      heartbeatIntervalMs = 30000,
      heartbeatTimeoutMs = 10000,
    } = this.options.nodeConfig;
    if (!enableHeartbeat || typeof instance.ping !== "function") return;

    this.stopHeartbeat();

    if (typeof instance.on === "function") {
      instance.on("pong", () => {
        this._isAlive = true;
        if (this.heartbeatTimeoutTimer != null) {
          clearTimeout(this.heartbeatTimeoutTimer);
          this.heartbeatTimeoutTimer = null;
        }
      });
    }

    this.heartbeatTimer = setInterval(() => {
      if (this._state !== "connected" || this.ws == null) return;
      try {
        instance.ping();
      } catch {
        return;
      }
      if (this.heartbeatTimeoutTimer == null) {
        this.heartbeatTimeoutTimer = setTimeout(() => {
          this.heartbeatTimeoutTimer = null;
          this._isAlive = false;
          this.events.emit(
            "debug",
            `Heartbeat pong not received within ${heartbeatTimeoutMs}ms — terminating dead connection to ${this.nodeId}`,
          );
          // terminate() fires "close", which runs the normal reconnect path
          const terminate = (instance as { terminate?: () => void }).terminate;
          if (typeof terminate === "function") {
            terminate.call(instance);
          } else {
            try {
              instance.close(4000, "Heartbeat timeout");
            } catch {
              // ignore
            }
          }
        }, heartbeatTimeoutMs);
        (this.heartbeatTimeoutTimer as { unref?: () => void }).unref?.();
      }
    }, heartbeatIntervalMs);
    (this.heartbeatTimer as { unref?: () => void }).unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer != null) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /** Resets the retry counter and forces a new connection attempt (e.g. after max retries were exhausted) */
  public async reconnect(): Promise<void> {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    await this.connect();
  }

  private scheduleReconnect(): void {
    if (this.destroyRequested) return;

    const delay = this.reconnectDelay;
    if (delay < 0) {
      this.events.emit("debug", "Max reconnection attempts reached");
      this.events.emit(
        "nodeError",
        this.nodeId,
        new Error(`Gave up reconnecting to ${this.nodeId} after ${this.reconnectAttempts} attempts`),
      );
      return;
    }

    this.reconnectAttempts++;
    this.events.emit("debug", `Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // reconnection failure is handled by onclose
      });
    }, delay);
  }

  public send(payload: Record<string, unknown>): void {
    if (this._state !== "connected" || this.ws === null) {
      throw new Error("Cannot send: WebSocket is not connected");
    }

    const data = JSON.stringify(payload);
    this.ws.send(data);
  }

  private teardownSocket(closeReason: string): void {
    this.stopHeartbeat();
    if (this.ws === null) return;

    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;
    this.ws.onopen = null;
    // Listeners registered via .on() (ws package) survive nulling the on* properties
    (this.ws as { removeAllListeners?: () => void }).removeAllListeners?.();

    try {
      if (this.ws.readyState === 0) {
        // CONNECTING sockets close faster with terminate() where available
        const terminate = (this.ws as { terminate?: () => void }).terminate;
        if (typeof terminate === "function") {
          terminate.call(this.ws);
        } else {
          this.ws.close(1000, closeReason);
        }
      } else if (this.ws.readyState === 1) {
        this.ws.close(1000, closeReason);
      }
    } catch {
      // ignore
    }

    this.ws = null;
  }

  public async close(): Promise<void> {
    this.destroyRequested = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.teardownSocket("Client shutdown");
    this._state = "disconnected";
    this.events.removeAllListeners();
  }

  public destroy(): void {
    this.destroyRequested = true;
    this._state = "destroyed";

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.teardownSocket("Destroy");
    this.events.removeAllListeners();
  }
}
