import type { Filter } from "./Filters.ts";
import {
  VolumeFilter,
  EqualizerFilter,
  KaraokeFilter,
  TimescaleFilter,
  TremoloFilter,
  VibratoFilter,
  RotationFilter,
  DistortionFilter,
  ChannelMixFilter,
  LowPassFilter,
} from "./Filters.ts";
import type { FiltersObject } from "../types/protocol.ts";

export type BassBoostLevel = "low" | "medium" | "high" | "extreme";

export type AudioOutput = "mono" | "stereo" | "left" | "right";

/** ChannelMix presets for routing audio output — mirrors lavalink-client's audioOutputsData */
export const AudioOutputs: Record<
  AudioOutput,
  { leftToLeft: number; leftToRight: number; rightToLeft: number; rightToRight: number }
> = {
  mono: { leftToLeft: 0.5, leftToRight: 0.5, rightToLeft: 0.5, rightToRight: 0.5 },
  stereo: { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 },
  left: { leftToLeft: 1, leftToRight: 0, rightToLeft: 1, rightToRight: 0 },
  right: { leftToLeft: 0, leftToRight: 1, rightToLeft: 0, rightToRight: 1 },
};

/**
 * Manages an active chain of Lavalink audio filters and provides preset shortcuts.
 */
export class FilterChain {
  private readonly filters: Map<string, Filter> = new Map();

  /** Adds a filter instance to the active chain */
  public add(filter: Filter): this {
    this.filters.set(filter.name, filter);
    return this;
  }

  /** Removes a filter by name from the chain */
  public remove(name: string): boolean {
    return this.filters.delete(name);
  }

  /** Gets a filter instance by name from the chain */
  public get(name: string): Filter | undefined {
    return this.filters.get(name);
  }

  /** Checks whether a filter exists in the chain */
  public has(name: string): boolean {
    return this.filters.has(name);
  }

  /** Clears all applied filters from the chain */
  public clear(): void {
    this.filters.clear();
  }

  /** Gets all active filter instances */
  public getAll(): Filter[] {
    return Array.from(this.filters.values());
  }

  /** Converts active filters to Lavalink v4 REST payload structure */
  public toPayload(): FiltersObject {
    const payload: FiltersObject = {};

    for (const filter of this.filters.values()) {
      const serialized = filter.serialize();
      Object.assign(payload, serialized);
    }

    return payload;
  }

  /** Applies a Lavalink filters object payload to populate internal filter states */
  public apply(payload: FiltersObject): void {
    this.clear();

    if (payload.volume !== undefined) {
      this.add(new VolumeFilter(payload.volume));
    }

    if (payload.equalizer !== undefined) {
      this.add(new EqualizerFilter(payload.equalizer));
    }

    if (payload.karaoke !== undefined) {
      this.add(new KaraokeFilter(payload.karaoke));
    }

    if (payload.timescale !== undefined) {
      this.add(new TimescaleFilter(payload.timescale));
    }

    if (payload.tremolo !== undefined) {
      this.add(new TremoloFilter(payload.tremolo));
    }

    if (payload.vibrato !== undefined) {
      this.add(new VibratoFilter(payload.vibrato));
    }

    if (payload.rotation !== undefined) {
      this.add(new RotationFilter(payload.rotation));
    }

    if (payload.distortion !== undefined) {
      this.add(new DistortionFilter(payload.distortion));
    }

    if (payload.channelMix !== undefined) {
      this.add(new ChannelMixFilter(payload.channelMix));
    }

    if (payload.lowPass !== undefined) {
      this.add(new LowPassFilter(payload.lowPass));
    }
  }

  /** Applies a Bass Boost equalizer preset; pass `false` to remove it */
  public setBassBoost(level: BassBoostLevel | false = "medium"): this {
    if (level === false) {
      this.remove("equalizer");
      return this;
    }

    const gains: Record<BassBoostLevel, number[]> = {
      low: [0.1, 0.08, 0.05, 0.0, 0.0],
      medium: [0.2, 0.15, 0.1, 0.05, 0.0],
      high: [0.35, 0.25, 0.15, 0.05, 0.0],
      extreme: [0.5, 0.4, 0.3, 0.15, 0.0],
    };

    const bandGains = gains[level];
    const eq = new EqualizerFilter();
    bandGains.forEach((gain, band) => {
      eq.setBand(band, gain);
    });

    return this.add(eq);
  }

  /** Applies a Nightcore timescale preset (speed: 1.25, pitch: 1.25) */
  public setNightcore(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("timescale");
      return this;
    }
    return this.add(new TimescaleFilter({ speed: 1.25, pitch: 1.25, rate: 1.0 }));
  }

  /** Applies a Vaporwave timescale preset (speed: 0.85, pitch: 0.8) */
  public setVaporwave(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("timescale");
      return this;
    }
    return this.add(new TimescaleFilter({ speed: 0.85, pitch: 0.8, rate: 1.0 }));
  }

  /** Applies an 8D audio rotation preset (0.2 Hz panning) */
  public set8D(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("rotation");
      return this;
    }
    return this.add(new RotationFilter({ rotationHz: 0.2 }));
  }

  /** Applies a Karaoke filter preset */
  public setKaraoke(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("karaoke");
      return this;
    }
    return this.add(new KaraokeFilter({ level: 1.0, monoLevel: 1.0, filterBand: 220, filterWidth: 100 }));
  }

  /** Applies a Pop equalizer preset */
  public setPop(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    const gains = [-0.06, -0.04, 0.02, 0.08, 0.14, 0.14, 0.08, 0.02, -0.04, -0.06];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /** Applies a Soft equalizer preset */
  public setSoft(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    const gains = [0.0, 0.02, 0.04, 0.06, 0.04, 0.02, 0.0, -0.02, -0.04, -0.06];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /** Applies a Treble & Bass equalizer preset */
  public setTrebleBass(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    const gains = [0.2, 0.15, 0.1, 0.05, 0.0, 0.0, 0.05, 0.1, 0.15, 0.2];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /** Applies a Rock equalizer preset */
  public setRock(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    const gains = [0.15, 0.1, 0.05, -0.05, -0.1, -0.05, 0.05, 0.1, 0.15, 0.2];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /** Applies a Classical equalizer preset */
  public setClassical(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    const gains = [0.15, 0.12, 0.08, 0.04, -0.02, -0.02, 0.0, 0.04, 0.08, 0.12];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /** Applies an Electronic equalizer preset */
  public setElectronic(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    const gains = [0.2, 0.15, 0.05, -0.05, -0.05, 0.05, 0.1, 0.15, 0.2, 0.25];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /** Applies a Slowed + Reverb preset (speed: 0.85, pitch: 0.85, lowPass filter) */
  public setSlowedReverb(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("timescale");
      this.remove("lowPass");
      return this;
    }
    this.add(new TimescaleFilter({ speed: 0.85, pitch: 0.85, rate: 1.0 }));
    return this.add(new LowPassFilter({ smoothing: 15.0 }));
  }

  /** Applies 3D Audio spatial rotation preset (0.2 Hz panning) */
  public set3DAudio(enabled: boolean = true): this {
    return this.set8D(enabled);
  }

  /** Shifts audio pitch by semitones (+/- 12 semitones) */
  public setPitchShift(semitones: number): this {
    if (semitones === 0) {
      this.remove("timescale");
      return this;
    }
    const pitch = Math.pow(2, semitones / 12);
    return this.add(new TimescaleFilter({ speed: 1.0, pitch, rate: 1.0 }));
  }

  /** Applies a Vocal / Voice Isolation EQ preset */
  public setVoiceIsolation(enabled: boolean = true): this {
    if (!enabled) {
      this.remove("equalizer");
      return this;
    }
    // Cut deep sub-bass and boost vocal frequencies (1kHz - 4kHz)
    const gains = [-0.25, -0.2, -0.1, 0.0, 0.15, 0.25, 0.2, 0.1, 0.0, -0.1];
    const eq = new EqualizerFilter();
    gains.forEach((gain, band) => eq.setBand(band, gain));
    return this.add(eq);
  }

  /**
   * Routes audio output via a ChannelMix preset: "mono", "stereo" (reset),
   * "left", or "right".
   */
  public setAudioOutput(output: AudioOutput): this {
    if (output === "stereo") {
      this.remove("channelMix");
      return this;
    }
    return this.add(new ChannelMixFilter(AudioOutputs[output]));
  }

  private static readonly presetRegistry: Map<string, FiltersObject> = new Map();

  /** Registers a custom named filter preset globally */
  public static registerPreset(name: string, payload: FiltersObject): void {
    FilterChain.presetRegistry.set(name, payload);
  }

  /** Applies a registered custom named filter preset */
  public applyPreset(name: string): boolean {
    const payload = FilterChain.presetRegistry.get(name);
    if (payload == null) return false;
    this.apply(payload);
    return true;
  }

  /** Removes every filter and returns the chain for one-call resets */
  public reset(): this {
    this.clear();
    return this;
  }

  /**
   * Clones this filter chain. The clone owns independent filter instances
   * (round-tripped through the payload), so mutating one chain never
   * affects the other.
   */
  public clone(): FilterChain {
    const chain = new FilterChain();
    chain.apply(this.toPayload());
    return chain;
  }
}
