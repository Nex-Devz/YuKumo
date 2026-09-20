import type { TrackData } from "../types/protocol.ts";

export type BeforeTrackStartHandler = (guildId: string, track: TrackData) => boolean | Promise<boolean>;

export class MiddlewareRegistry {
  private readonly beforeTrackStartHandlers: BeforeTrackStartHandler[] = [];

  /** Registers a handler to execute before any track begins playback */
  public useBeforeTrackStart(handler: BeforeTrackStartHandler): this {
    this.beforeTrackStartHandlers.push(handler);
    return this;
  }

  /** Executes all registered beforeTrackStart handlers. Returns false if any handler rejects playback */
  public async runBeforeTrackStart(guildId: string, track: TrackData): Promise<boolean> {
    for (const handler of this.beforeTrackStartHandlers) {
      try {
        const allowed = await handler(guildId, track);
        if (allowed === false) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}
