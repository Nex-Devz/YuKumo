import { EventDispatcher } from "../ws/EventDispatcher.ts";
import type { VoiceStateUpdate, VoiceServerUpdate, InternalVoiceState } from "../types/internal.ts";

export interface VoiceConnectionState {
  guildId: string;
  sessionId: string | null;
  channelId: string | null;
  endpoint: string | null;
  token: string | null;
  connected: boolean;
  reconnecting: boolean;
}

const DEBOUNCE_MS = 50;

export class VoiceStateTracker {
  private readonly states = new Map<string, VoiceConnectionState>();
  private readonly events: EventDispatcher;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  public constructor(events: EventDispatcher) {
    this.events = events;
  }

  public handleVoiceStateUpdate(data: VoiceStateUpdate): void {
    const existing = this.states.get(data.guildId);

    if (data.channelId == null) {
      this.disconnectGuild(data.guildId);
      return;
    }

    if (existing != null && existing.sessionId != null && existing.sessionId !== data.sessionId) {
      this.handleSessionChange(data);
      return;
    }

    this.updateState(data.guildId, {
      sessionId: data.sessionId,
      channelId: data.channelId,
    });

    this.scheduleReadyCheck(data.guildId);
  }

  public handleVoiceServerUpdate(guildId: string, data: VoiceServerUpdate): void {
    // Discord sends endpoint: null while allocating a new voice region —
    // keep the last working endpoint/token and wait for the real one
    // instead of clobbering a live connection
    if (data.endpoint == null) {
      return;
    }

    this.updateState(guildId, {
      endpoint: data.endpoint,
      token: data.token,
    });

    this.scheduleReadyCheck(guildId);
  }

  public isReady(guildId: string): boolean {
    const state = this.states.get(guildId);
    if (state == null) return false;
    return state.sessionId != null && state.endpoint != null && state.token != null && state.connected;
  }

  public getState(guildId: string): VoiceConnectionState | undefined {
    return this.states.get(guildId);
  }

  public getAll(): VoiceConnectionState[] {
    return Array.from(this.states.values());
  }

  public remove(guildId: string): void {
    this.clearDebounce(guildId);
    this.states.delete(guildId);
  }

  public getVoiceState(guildId: string): InternalVoiceState | null {
    const state = this.states.get(guildId);
    if (state == null) return null;
    return {
      sessionId: state.sessionId,
      channelId: state.channelId,
      endpoint: state.endpoint,
      token: state.token,
    };
  }

  private disconnectGuild(guildId: string): void {
    const state = this.states.get(guildId);
    if (state == null) return;

    this.clearDebounce(guildId);
    this.states.delete(guildId);

    this.events.emit("voiceDisconnected", guildId);
  }

  private handleSessionChange(data: VoiceStateUpdate): void {
    const state = this.states.get(data.guildId)!;
    const wasConnected = state.connected;

    state.sessionId = data.sessionId;
    state.channelId = data.channelId;
    state.endpoint = null;
    state.token = null;
    state.connected = false;
    state.reconnecting = true;

    if (wasConnected) {
      this.events.emit("voiceReconnecting", data.guildId);
    }

    this.scheduleReadyCheck(data.guildId);
  }

  private updateState(guildId: string, partial: Partial<VoiceConnectionState>): void {
    const existing = this.states.get(guildId);
    if (existing != null) {
      Object.assign(existing, partial);
    } else {
      const state: VoiceConnectionState = {
        guildId,
        sessionId: null,
        channelId: null,
        endpoint: null,
        token: null,
        connected: false,
        reconnecting: false,
        ...partial,
      };
      this.states.set(guildId, state);
    }
  }

  private scheduleReadyCheck(guildId: string): void {
    this.clearDebounce(guildId);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(guildId);
      this.checkReady(guildId);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(guildId, timer);
  }

  private clearDebounce(guildId: string): void {
    const timer = this.debounceTimers.get(guildId);
    if (timer != null) {
      clearTimeout(timer);
      this.debounceTimers.delete(guildId);
    }
  }

  private checkReady(guildId: string): void {
    const state = this.states.get(guildId);
    if (state == null) return;

    if (state.sessionId != null && state.endpoint != null && state.token != null) {
      state.connected = true;
      state.reconnecting = false;
      this.events.emit("voiceReady", guildId);
    }
  }
}
