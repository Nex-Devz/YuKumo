export class YuKumoError extends Error {
  public readonly code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    // Forwarding cause preserves the original error's stack when wrapping
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YuKumoError";
    this.code = code;
  }
}

export class NodeError extends YuKumoError {
  public readonly nodeName: string;

  constructor(message: string, nodeName: string, code?: string) {
    super(message, code ?? "NODE_ERROR");
    this.name = "NodeError";
    this.nodeName = nodeName;
  }
}

export class NodeConnectionError extends NodeError {
  constructor(message: string, nodeName: string) {
    super(message, nodeName, "NODE_CONNECTION_ERROR");
    this.name = "NodeConnectionError";
  }
}

export class PlayerError extends YuKumoError {
  public readonly guildId: string;

  constructor(message: string, guildId: string, code?: string) {
    super(message, code ?? "PLAYER_ERROR");
    this.name = "PlayerError";
    this.guildId = guildId;
  }
}

export class PlayerNotConnectedError extends PlayerError {
  constructor(guildId: string, detail?: string) {
    super(
      detail != null
        ? `Player for guild ${guildId} is not connected: ${detail}`
        : `Player for guild ${guildId} is not connected`,
      guildId,
      "PLAYER_NOT_CONNECTED",
    );
    this.name = "PlayerNotConnectedError";
  }
}

export class RestError extends YuKumoError {
  public readonly statusCode: number;
  public readonly path: string;

  constructor(message: string, statusCode: number, path: string, code?: string) {
    super(message, code ?? "REST_ERROR");
    this.name = "RestError";
    this.statusCode = statusCode;
    this.path = path;
  }
}

export class QueueError extends YuKumoError {
  constructor(message: string, code?: string) {
    super(message, code ?? "QUEUE_ERROR");
    this.name = "QueueError";
  }
}

export class QueueFullError extends QueueError {
  constructor(maxSize: number) {
    super(`Queue has reached maximum size of ${maxSize}`, "QUEUE_FULL");
    this.name = "QueueFullError";
  }
}

export class PluginError extends YuKumoError {
  public readonly pluginName: string;

  constructor(message: string, pluginName: string, code?: string, options?: { cause?: unknown }) {
    super(message, code ?? "PLUGIN_ERROR", options);
    this.name = "PluginError";
    this.pluginName = pluginName;
  }
}

export class StorageError extends YuKumoError {
  constructor(message: string, code?: string, options?: { cause?: unknown }) {
    super(message, code ?? "STORAGE_ERROR", options);
    this.name = "StorageError";
  }
}

export class VoiceError extends YuKumoError {
  public readonly guildId: string;

  constructor(message: string, guildId: string, code?: string) {
    super(message, code ?? "VOICE_ERROR");
    this.name = "VoiceError";
    this.guildId = guildId;
  }
}

export class LoadError extends YuKumoError {
  constructor(message: string, code?: string) {
    super(message, code ?? "LOAD_ERROR");
    this.name = "LoadError";
  }
}

/**
 * Thrown when a feature is requested on a node that does not support it — e.g.
 * calling a NodeLink-only method (lyrics, chapters, voice receive, an extra
 * filter) on a plain Lavalink node. Carries the offending feature and the node
 * so callers can route to a capable node or fall back.
 */
export class YukumoUnsupportedFeatureError extends YuKumoError {
  public readonly feature: string;
  public readonly nodeId: string;
  public readonly nodeType: string;

  constructor(feature: string, nodeId: string, nodeType: string) {
    super(`Node "${nodeId}" (${nodeType}) does not support the "${feature}" feature`, "UNSUPPORTED_FEATURE");
    this.name = "YukumoUnsupportedFeatureError";
    this.feature = feature;
    this.nodeId = nodeId;
    this.nodeType = nodeType;
  }
}
