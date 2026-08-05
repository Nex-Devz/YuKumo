import WebSocket from "ws";
import type { NodeConfig } from "../types/internal.ts";

/** startSpeakingEvent payload from NodeLink's /connection/data socket */
export interface VoiceStartSpeaking {
  userId: string;
  guildId: string;
}

/** endSpeakingEvent payload — carries the captured audio */
export interface VoiceEndSpeaking {
  userId: string;
  guildId: string;
  /** Base64-encoded captured audio */
  data: string;
  /** Audio format of `data` */
  type: "opus" | "pcm" | string;
}

export interface NodeLinkVoiceReceiverEvents {
  startSpeaking: (event: VoiceStartSpeaking) => void;
  endSpeaking: (event: VoiceEndSpeaking) => void;
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

/**
 * Receives voice data from a NodeLink node via its /connection/data WebSocket
 * (NodeLink-exclusive — Lavalink has no voice receive). Emits `startSpeaking`
 * when a user begins speaking and `endSpeaking` with the base64 opus/pcm audio
 * once the user stops and processing completes.
 */
export class NodeLinkVoiceReceiver {
  private readonly options: NodeLinkVoiceReceiverOptions;
  private readonly listeners = new Map<keyof NodeLinkVoiceReceiverEvents, Set<(...args: any[]) => void>>();
  private ws: WebSocket | null = null;
  private _connected = false;
  private _destroyed = false;

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
    set.add(callback as (...args: any[]) => void);
    return this;
  }

  public off<E extends keyof NodeLinkVoiceReceiverEvents>(
    event: E,
    callback?: NodeLinkVoiceReceiverEvents[E],
  ): this {
    if (callback == null) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(callback as (...args: any[]) => void);
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

  /** Opens the /connection/data WebSocket; resolves once the socket is open */
  public async connect(): Promise<void> {
    if (this._destroyed) throw new Error("Voice receiver is destroyed");
    if (this.ws != null) return;

    const { host, port, password, secure } = this.options.nodeConfig;
    const protocol = secure === true ? "wss" : "ws";
    const url = `${protocol}://${host}:${port}/connection/data`;

    const headers: Record<string, string> = {
      Authorization: password,
      "User-Id": this.options.userId,
      "Guild-Id": this.options.guildId,
      "Client-Name": this.options.clientName,
    };

    const instance = new WebSocket(url, { headers });
    this.ws = instance;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      instance.on("open", () => {
        this._connected = true;
        this.emit("debug", `Voice receive socket connected for guild ${this.options.guildId}`);
        this.emit("open");
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      instance.on("message", (raw: WebSocket.RawData) => {
        this.handleMessage(raw.toString());
      });

      instance.on("close", (code: number, reason: Buffer) => {
        this._connected = false;
        this.ws = null;
        this.emit("close", code, reason.toString());
        if (!settled) {
          settled = true;
          reject(new Error(`Voice receive socket closed before opening: code=${code}`));
        }
      });

      instance.on("error", (err: Error) => {
        this.emit("error", err);
        // "close" follows and settles the promise
      });
    });
  }

  private handleMessage(data: string): void {
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

  /** Closes the socket and removes all listeners */
  public destroy(): void {
    this._destroyed = true;
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
    this.listeners.clear();
  }
}
