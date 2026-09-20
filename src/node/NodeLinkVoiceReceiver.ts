import WebSocket from "ws";
import type { NodeConfig } from "../types/internal.ts";

/** startSpeaking payload from NodeLink's voice receive socket */
export interface VoiceStartSpeaking {
  userId: string;
  guildId: string;
}

/** endSpeaking payload — carries the captured audio */
export interface VoiceEndSpeaking {
  userId: string;
  guildId: string;
  /** Base64-encoded captured audio */
  data: string;
  /** Audio format of `data` */
  type: "opus" | "ogg" | "pcm_s16le" | string;
}

/** Real-time voice frame (NodeLink binary protocol) */
export interface VoiceDataFrame {
  userId: string;
  guildId: string;
  ssrc: number;
  timestamp: number;
  /** Raw payload bytes for this frame */
  payload: Buffer;
}

export interface NodeLinkVoiceReceiverEvents {
  startSpeaking: (event: VoiceStartSpeaking) => void;
  endSpeaking: (event: VoiceEndSpeaking) => void;
  /** Streamed per-frame audio for real-time consumers */
  data: (frame: VoiceDataFrame) => void;
  open: () => void;
  close: (code: number, reason: string) => void;
  error: (error: Error) => void;
  debug: (message: string) => void;
}

export interface NodeLinkVoiceReceiverOptions {
  nodeConfig: NodeConfig;
  userId: string;
  guildId: string;
  clientName: string;
}

/** Binary op codes from NodeLink's voice receive protocol */
const OP_START = 1;
const OP_STOP = 2;
const OP_DATA = 3;

/** Audio format bytes */
const FORMAT_OPUS = 0;
const FORMAT_OGG = 1;
const FORMAT_PCM = 2;

const FORMAT_NAMES: Record<number, string> = {
  [FORMAT_OPUS]: "opus",
  [FORMAT_OGG]: "ogg",
  [FORMAT_PCM]: "pcm_s16le",
};

/**
 * Receives voice data from a NodeLink node via its voice receive WebSocket
 * (NodeLink-exclusive — Lavalink has no voice receive). Connects to
 * `/v4/websocket/voice/:guildId` and parses the binary frame protocol
 * (op/format/guildId/userId/ssrc/timestamp/payload), while also tolerating the
 * legacy `/connection/data` JSON "speak" messages. Emits `startSpeaking` when a
 * user begins speaking and `endSpeaking` with the base64 audio once they stop.
 * Reconnects automatically on unexpected disconnects.
 */
export class NodeLinkVoiceReceiver {
  private readonly options: NodeLinkVoiceReceiverOptions;
  private readonly listeners = new Map<keyof NodeLinkVoiceReceiverEvents, Set<(...args: unknown[]) => void>>();
  private ws: WebSocket | null = null;
  private _connected = false;
  private _destroyed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Audio buffer for the current speech session (reset on stop) */
  private speechBuffer: Buffer | null = null;

  public constructor(options: NodeLinkVoiceReceiverOptions) {
    this.options = options;
  }

  public get connected(): boolean {
    return this._connected;
  }

  public get guildId(): string {
    return this.options.guildId;
  }

  public on<E extends keyof NodeLinkVoiceReceiverEvents>(
    event: E,
    callback: NodeLinkVoiceReceiverEvents[E],
  ): this {
    let set = this.listeners.get(event);
    if (set == null) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback as (...args: unknown[]) => void);
    return this;
  }

  public off<E extends keyof NodeLinkVoiceReceiverEvents>(
    event: E,
    callback?: NodeLinkVoiceReceiverEvents[E],
  ): this {
    if (callback == null) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(callback as (...args: unknown[]) => void);
    }
    return this;
  }

  private emit<E extends keyof NodeLinkVoiceReceiverEvents>(
    event: E,
    ...args: Parameters<NodeLinkVoiceReceiverEvents[E]>
  ): void {
    const set = this.listeners.get(event);
    if (set == null) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch {
        // listener errors must not break the receive stream
      }
    }
  }

  /** Opens the voice receive WebSocket; resolves once the socket is open */
  public async connect(): Promise<void> {
    if (this._destroyed) throw new Error("Voice receiver is destroyed");
    if (this.ws != null) return;

    const { host, port, password, secure } = this.options.nodeConfig;
    const protocol = secure === true ? "wss" : "ws";
    const url = `${protocol}://${host}:${port}/v4/websocket/voice/${this.options.guildId}`;

    const headers: Record<string, string> = {
      Authorization: password,
      "User-Id": this.options.userId,
      "Client-Name": this.options.clientName,
    };

    const instance = new WebSocket(url, { headers });
    this.ws = instance;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      instance.on("open", () => {
        this._connected = true;
        this.reconnectAttempts = 0;
        this.emit("debug", `Voice receive socket connected for guild ${this.options.guildId}`);
        this.emit("open");
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      instance.on("message", (raw: WebSocket.RawData, isBinary?: boolean) => {
        this.handleMessage(raw, isBinary);
      });

      instance.on("close", (code: number, reason: Buffer) => {
        this._connected = false;
        this.ws = null;
        this.speechBuffer = null;
        this.emit("close", code, reason.toString());
        if (!settled) {
          settled = true;
          reject(new Error(`Voice receive socket closed before opening: code=${code}`));
        } else if (!this._destroyed) {
          this.scheduleReconnect();
        }
      });

      instance.on("error", (err: Error) => {
        this.emit("error", err);
        // "close" follows and settles the promise
      });
    });
  }

  private get reconnectDelay(): number {
    const { maxRetries = 5, retryDelay = 1000, retryDelayMax = 30000 } = this.options.nodeConfig;
    if (this.reconnectAttempts >= maxRetries) {
      return -1;
    }
    const base = Math.min(retryDelay * 2 ** this.reconnectAttempts, retryDelayMax);
    return base / 2 + Math.random() * (base / 2);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    const delay = this.reconnectDelay;
    if (delay < 0) {
      this.emit("debug", `Max voice receive reconnect attempts reached for guild ${this.options.guildId}`);
      return;
    }

    this.reconnectAttempts++;
    this.emit("debug", `Scheduling voice receive reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // reconnection failure is handled by onclose
      });
    }, delay);
    (this.reconnectTimer as { unref?: () => void }).unref?.();
  }

  private handleMessage(raw: WebSocket.RawData, isBinary?: boolean): void {
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : Array.isArray(raw)
          ? Buffer.concat(raw.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))))
          : Buffer.from(raw as string);

    // Binary frames are the NodeLink v4 voice receive protocol
    if (
      isBinary === true ||
      (buffer.length >= 3 && buffer.readUInt8(0) >= OP_START && buffer.readUInt8(0) <= OP_DATA)
    ) {
      this.handleBinaryFrame(buffer);
      return;
    }

    this.handleJsonMessage(buffer.toString());
  }

  /** Parses NodeLink's binary voice frame: [op][format][guildLen][guildId][userLen][userId][ssrc:4][ts:4][payload] */
  private handleBinaryFrame(buffer: Buffer): void {
    try {
      const op = buffer.readUInt8(0);
      const format = buffer.readUInt8(1);
      const guildLen = buffer.readUInt8(2);
      const guildId = buffer.subarray(3, 3 + guildLen).toString("utf8");
      let offset = 3 + guildLen;
      const userLen = buffer.readUInt8(offset);
      offset += 1;
      const userId = buffer.subarray(offset, offset + userLen).toString("utf8");
      offset += userLen;
      const ssrc = buffer.readUInt32BE(offset);
      offset += 4;
      const timestamp = buffer.readUInt32BE(offset);
      offset += 4;
      const payload = buffer.subarray(offset);

      if (op === OP_START) {
        this.speechBuffer = null;
        this.emit("startSpeaking", { userId, guildId });
        return;
      }

      if (op === OP_DATA) {
        const frame: VoiceDataFrame = { userId, guildId, ssrc, timestamp, payload };
        this.emit("data", frame);
        this.speechBuffer = this.speechBuffer != null ? Buffer.concat([this.speechBuffer, payload]) : payload;
        return;
      }

      if (op === OP_STOP) {
        const captured = this.speechBuffer;
        this.speechBuffer = null;
        this.emit("endSpeaking", {
          userId,
          guildId,
          data: captured != null ? captured.toString("base64") : "",
          type: FORMAT_NAMES[format] ?? `format_${format}`,
        });
        return;
      }

      this.emit("debug", `Unknown binary voice op: ${op}`);
    } catch (err) {
      this.emit("debug", `Failed to parse binary voice frame: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Legacy /connection/data JSON "speak" messages */
  private handleJsonMessage(data: string): void {
    let parsed: { op?: string; type?: string; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      this.emit("debug", "Failed to parse voice receive message");
      return;
    }

    if (parsed.op !== "speak" || parsed.data == null) {
      this.emit("debug", `Unknown voice receive op: ${String(parsed.op)}`);
      return;
    }

    switch (parsed.type) {
      case "startSpeakingEvent": {
        this.emit("startSpeaking", parsed.data as unknown as VoiceStartSpeaking);
        break;
      }
      case "endSpeakingEvent": {
        this.emit("endSpeaking", parsed.data as unknown as VoiceEndSpeaking);
        break;
      }
      default: {
        this.emit("debug", `Unknown voice receive event type: ${String(parsed.type)}`);
      }
    }
  }

  /** Manually closes the socket without scheduling a reconnect */
  public async close(): Promise<void> {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws != null) {
      try {
        this.ws.removeAllListeners();
        this.ws.close(1000, "Receiver closed");
      } catch {
        // ignore
      }
      this.ws = null;
      this._connected = false;
      this.speechBuffer = null;
    }
  }

  /** Closes the socket and removes all listeners */
  public async destroy(): Promise<void> {
    this._destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._connected = false;
    if (this.ws != null) {
      try {
        this.ws.removeAllListeners();
        this.ws.close(1000, "Receiver destroyed");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.speechBuffer = null;
    this.listeners.clear();
  }
}