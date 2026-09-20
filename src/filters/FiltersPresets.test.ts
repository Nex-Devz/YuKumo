import { describe, it, expect } from "vitest";
import { FilterChain } from "./FilterChain.ts";

describe("FilterChain Presets & Custom Registry", () => {
  it("should apply SlowedReverb preset", () => {
    const chain = new FilterChain();
    chain.setSlowedReverb(true);
    expect(chain.has("timescale")).toBe(true);
    expect(chain.has("lowPass")).toBe(true);
  });

  it("should calculate correct pitch shift for semitones", () => {
    const chain = new FilterChain();
    chain.setPitchShift(12); // 1 octave up -> pitch 2.0
    const payload = chain.toPayload();
    expect(payload.timescale?.pitch).toBeCloseTo(2.0, 5);
  });

  it("should register and apply custom presets", () => {
    FilterChain.registerPreset("superbass", {
      equalizer: [{ band: 0, gain: 0.5 }],
    });

    const chain = new FilterChain();
    const applied = chain.applyPreset("superbass");
    expect(applied).toBe(true);
    expect(chain.has("equalizer")).toBe(true);
    expect(chain.toPayload().equalizer).toEqual([{ band: 0, gain: 0.5 }]);
  });

  describe("plugin filters (LavaDSPX / arbitrary server-side filter plugins)", () => {
    it("serializes plugin filters under pluginFilters", () => {
      const chain = new FilterChain();
      chain.setPluginFilter("normalization", { maxAmplitude: 0.75, adaptive: true });
      chain.setPluginFilter("echo", { echoLength: 0.5, decay: 0.3 });

      expect(chain.toPayload().pluginFilters).toEqual({
        normalization: { maxAmplitude: 0.75, adaptive: true },
        echo: { echoLength: 0.5, decay: 0.3 },
      });
      expect(chain.hasPluginFilter("normalization")).toBe(true);
      expect(chain.getPluginFilter("echo")).toEqual({ echoLength: 0.5, decay: 0.3 });
    });

    it("omits pluginFilters entirely when none are set", () => {
      const chain = new FilterChain();
      chain.setNightcore(true);
      expect(chain.toPayload().pluginFilters).toBeUndefined();
    });

    it("removes a plugin filter when passed false", () => {
      const chain = new FilterChain();
      chain.setPluginFilter("lowPass", { smoothing: 20 });
      chain.setPluginFilter("lowPass", false);
      expect(chain.hasPluginFilter("lowPass")).toBe(false);
      expect(chain.toPayload().pluginFilters).toBeUndefined();
    });

    it("round-trips plugin filters through apply()", () => {
      const chain = new FilterChain();
      chain.apply({ pluginFilters: { highPass: { cutoffFrequency: 1500 } } });
      expect(chain.getPluginFilter("highPass")).toEqual({ cutoffFrequency: 1500 });
      expect(chain.toPayload().pluginFilters).toEqual({ highPass: { cutoffFrequency: 1500 } });
    });

    it("clear() drops plugin filters too", () => {
      const chain = new FilterChain();
      chain.setPluginFilter("normalization", { maxAmplitude: 1 });
      chain.clear();
      expect(chain.hasPluginFilter("normalization")).toBe(false);
    });
  });
});
