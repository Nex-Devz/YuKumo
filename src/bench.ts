/**
 * Benchmark measuring YuKumo startup latency, queue throughput,
 * event dispatching, and binary track encoding/decoding performance.
 *
 * Run:
 *   bun run bench              colored report
 *   bun run bench --json       machine-readable output
 *   bun run bench --no-color   plain text output
 */
import { readFileSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { YuKumo } from "./YuKumo.ts";
import { Queue } from "./queue/Queue.ts";
import { EventDispatcher } from "./ws/EventDispatcher.ts";
import { encodeTrackInfo, decodeTrackInfo } from "./tracks/TrackEncoder.ts";
import { FilterChain } from "./filters/FilterChain.ts";
import type { TrackData, TrackInfo } from "./types/protocol.ts";

const RULE_WIDTH = 66;
const LABEL_WIDTH = 26;
const TIME_WIDTH = 9;
const OPS_WIDTH = 13;
const BAR_WIDTH = 14;

interface MetricResult {
  label: string;
  ms: number;
  opsPerSecond: number | null;
}

interface SuiteResult {
  id: number;
  title: string;
  subtitle: string;
  metrics: MetricResult[];
  durationMs: number;
}

type Style = (text: string) => string;

interface Palette {
  dim: Style;
  gray: Style;
  cyan: Style;
  brightGreen: Style;
  brightCyan: Style;
  brightWhite: Style;
  boldWhite: Style;
  boldMagenta: Style;
}

function createPalette(enabled: boolean): Palette {
  const paint =
    (open: string): Style =>
    (text) =>
      enabled && text.length > 0 ? `${open}${text}\x1b[0m` : text;

  return {
    dim: paint("\x1b[2m"),
    gray: paint("\x1b[90m"),
    cyan: paint("\x1b[36m"),
    brightGreen: paint("\x1b[92m"),
    brightCyan: paint("\x1b[96m"),
    brightWhite: paint("\x1b[97m"),
    boldWhite: paint("\x1b[1m\x1b[97m"),
    boldMagenta: paint("\x1b[1m\x1b[95m"),
  };
}

function detectColor(forceOff: boolean): boolean {
  if (forceOff || process.env.NO_COLOR || process.env.TERM === "dumb") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

function measure(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function opsPerSecond(count: number, ms: number): number {
  return ms > 0 ? (count / ms) * 1000 : 0;
}

function metric(label: string, ms: number, count: number): MetricResult {
  return { label, ms, opsPerSecond: opsPerSecond(count, ms) };
}

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(1)} µs`;
  return `${(ms * 1e6).toFixed(0)} ns`;
}

function formatOps(ops: number): string {
  if (ops >= 1e9) return `${(ops / 1e9).toFixed(2)}G ops/s`;
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M ops/s`;
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}K ops/s`;
  return `${Math.round(ops)} ops/s`;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** Turns "1,000,000 tracks" into "1M tracks" for the compact summary. */
function compactCount(text: string): string {
  return text.replace(/,000,000/g, "M").replace(/,000/g, "k");
}

function renderBar(ratio: number, fill: Style, track: Style): string {
  const filled = ratio > 0 ? Math.max(1, Math.min(BAR_WIDTH, Math.round(ratio * BAR_WIDTH))) : 0;
  return fill("█".repeat(filled)) + track("░".repeat(BAR_WIDTH - filled));
}

function coreCount(): number {
  return typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
}

function runtimeName(): string {
  const bun = (globalThis as { Bun?: { version?: string } }).Bun;
  if (bun?.version) return `Bun ${bun.version}`;
  return `Node ${process.version}`;
}

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function makeTrack(id: number): TrackData {
  return {
    encoded: `bench-${id}`,
    info: {
      identifier: `id-${id}`,
      isSeekable: true,
      author: "YuKumo Benchmarks",
      length: 300000,
      isStream: false,
      position: 0,
      title: `Benchmark Track Title ${id}`,
      uri: `https://example.com/audio/${id}.mp3`,
      artworkUrl: `https://example.com/art/${id}.jpg`,
      isrc: null,
      sourceName: "youtube",
    },
    pluginInfo: {},
  };
}

/** Warms the queue's hot paths so the first measured pass isn't paying JIT costs. */
function warmQueue(): void {
  const queue = new Queue<TrackData>();
  for (let i = 0; i < 20_000; i++) {
    queue.enqueue(makeTrack(i));
  }
  queue.start();
  while (queue.next() != null) {
    /* warm-up */
  }
  queue.shuffle();
}

async function benchmarkStartup(): Promise<MetricResult[]> {
  const start = performance.now();
  const client = new YuKumo({
    nodes: [{ host: "localhost", port: 2333, password: "test" }],
  });
  const ms = performance.now() - start;
  await client.destroy();

  return [{ label: "Instance creation", ms, opsPerSecond: null }];
}

async function benchmarkQueueOps(count: number): Promise<MetricResult[]> {
  const tracks = Array.from({ length: count }, (_, i) => makeTrack(i));
  warmQueue();

  const queue = new Queue<TrackData>();
  const enqueueMs = measure(() => {
    for (const track of tracks) queue.enqueue(track);
  });

  let dequeued = 0;
  queue.start();
  const iterateMs = measure(() => {
    while (queue.next() != null) {
      dequeued++;
    }
  });

  const bigQueue = new Queue<TrackData>();
  for (const track of tracks) bigQueue.enqueue(track);
  const shuffleMs = measure(() => bigQueue.shuffle());

  return [
    metric("Enqueue", enqueueMs, count),
    metric("Iterate", iterateMs, dequeued),
    metric("Shuffle", shuffleMs, count),
  ];
}

async function benchmarkEventDispatch(count: number): Promise<MetricResult[]> {
  const dispatcher = new EventDispatcher();
  const handler = () => {
    /* noop */
  };

  // Warm-up pass before measuring registration and emission.
  for (let i = 0; i < 5_000; i++) dispatcher.on("trackStart", handler);
  for (let i = 0; i < 5_000; i++) dispatcher.emit("trackStart", "guild", makeTrack(i));
  dispatcher.removeAllListeners();

  const registerMs = measure(() => {
    for (let i = 0; i < count; i++) {
      dispatcher.on("trackStart", handler);
    }
  });

  dispatcher.removeAllListeners();
  dispatcher.on("trackStart", handler);

  const emitMs = measure(() => {
    for (let i = 0; i < count; i++) {
      dispatcher.emit("trackStart", "guild", makeTrack(i));
    }
  });

  return [metric("Register listeners", registerMs, count), metric("Emit events", emitMs, count)];
}

async function benchmarkTrackEncoding(count: number): Promise<MetricResult[]> {
  const sampleInfo: TrackInfo = {
    title: "Never Gonna Give You Up",
    author: "Rick Astley",
    length: 213000,
    identifier: "dQw4w9WgXcQ",
    isStream: false,
    uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    sourceName: "youtube",
    position: 0,
    isSeekable: true,
    artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    isrc: null,
  };

  let encodedSample = "";
  for (let i = 0; i < 5_000; i++) {
    encodedSample = encodeTrackInfo(sampleInfo);
    decodeTrackInfo(encodedSample);
  }

  const encodeMs = measure(() => {
    for (let i = 0; i < count; i++) {
      encodedSample = encodeTrackInfo(sampleInfo);
    }
  });

  const decodeMs = measure(() => {
    for (let i = 0; i < count; i++) {
      decodeTrackInfo(encodedSample);
    }
  });

  return [metric("Encode", encodeMs, count), metric("Decode", decodeMs, count)];
}

async function benchmarkFilterChain(count: number): Promise<MetricResult[]> {
  const chain = new FilterChain();
  chain.apply({
    volume: 1.2,
    equalizer: [
      { band: 0, gain: 0.2 },
      { band: 1, gain: 0.15 },
    ],
    timescale: { speed: 1.1, pitch: 1.05 },
    karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220, filterWidth: 100 },
  });

  for (let i = 0; i < 5_000; i++) chain.toPayload();

  const serializeMs = measure(() => {
    for (let i = 0; i < count; i++) {
      chain.toPayload();
    }
  });

  return [metric("Serialize FilterChain", serializeMs, count)];
}

function printHeader(p: Palette, version: string): void {
  const inner = 62;
  const title = "YuKumo Benchmarks";
  const leftPlain = `◆  ${title}`;
  const versionPlain = `v${version}`;
  const envPlain = `${runtimeName()} · ${process.platform}-${process.arch} · ${coreCount()} cores`;
  const versionGap = " ".repeat(Math.max(0, inner - leftPlain.length - versionPlain.length - 4));
  const envGap = " ".repeat(Math.max(0, inner - envPlain.length - 6));
  const edge = (text: string) => p.brightCyan(text);

  console.log();
  console.log(`  ${edge(`╭${"─".repeat(inner)}╮`)}`);
  console.log(
    `  ${edge("│")}  ${p.boldMagenta("◆")}  ${p.boldWhite(title)}${versionGap}${p.dim(versionPlain)}  ${edge("│")}`,
  );
  console.log(`  ${edge("│")}    ${p.gray(envPlain)}${envGap}  ${edge("│")}`);
  console.log(`  ${edge(`╰${"─".repeat(inner)}╯`)}`);
  console.log(`  ${p.dim("Higher ops/s is better · every suite runs a warm-up pass first")}`);
}

function printSuite(p: Palette, suite: SuiteResult): void {
  const maxOps = Math.max(0, ...suite.metrics.map((metric) => metric.opsPerSecond ?? 0));

  console.log();
  console.log(
    `  ${p.boldMagenta(String(suite.id).padStart(2, "0"))}  ${p.boldWhite(suite.title)}  ${p.dim(`· ${suite.subtitle}`)}`,
  );
  console.log(`  ${p.gray("─".repeat(RULE_WIDTH))}`);

  for (const metric of suite.metrics) {
    const label = p.gray(metric.label.padEnd(LABEL_WIDTH));
    const time = p.brightWhite(formatTime(metric.ms).padStart(TIME_WIDTH));
    let line = `     ${label} ${time}`;

    if (metric.opsPerSecond != null) {
      const isFastest = metric.opsPerSecond === maxOps && maxOps > 0;
      const accent = isFastest ? p.brightGreen : p.cyan;
      const ops = accent(formatOps(metric.opsPerSecond).padStart(OPS_WIDTH));
      const ratio = maxOps > 0 ? metric.opsPerSecond / maxOps : 0;
      line += `  ${ops}  ${renderBar(ratio, accent, p.gray)}`;
    }

    console.log(line);
  }
}

function printSummary(p: Palette, suites: SuiteResult[], totalMs: number): void {
  console.log();
  console.log(`  ${p.gray("─".repeat(RULE_WIDTH))}`);
  console.log(`  ${p.boldWhite("Summary")}`);
  console.log();
  console.log(
    `  ${p.dim("Suite".padEnd(38))}${p.dim("Run time".padStart(10))}  ${p.dim("Peak".padStart(OPS_WIDTH))}`,
  );

  for (const suite of suites) {
    const peak = suite.metrics.reduce<number | null>((best, metric) => {
      if (metric.opsPerSecond == null) return best;
      return best == null || metric.opsPerSecond > best ? metric.opsPerSecond : best;
    }, null);
    const name = `${String(suite.id).padStart(2, "0")} ${suite.title} · ${compactCount(suite.subtitle)}`;

    console.log(
      `  ${p.gray(name.padEnd(38))}` +
        `${p.brightWhite(formatTime(suite.durationMs).padStart(10))}  ` +
        `${peak == null ? p.dim("—".padStart(OPS_WIDTH)) : p.brightGreen(formatOps(peak).padStart(OPS_WIDTH))}`,
    );
  }

  console.log(`  ${p.gray("Total".padEnd(38))}${p.brightWhite(formatTime(totalMs).padStart(10))}`);
  console.log();
  console.log(
    `  ${p.brightGreen("✓")} ${p.boldWhite("Done")} ${p.dim(`in ${formatTime(totalMs)} across ${suites.length} suites`)}`,
  );
  console.log();
}

function printHelp(): void {
  console.log(`
YuKumo Benchmarks

Usage:
  bun run bench [options]

Options:
  --json       Print machine-readable JSON instead of the report
  --no-color   Disable ANSI colors
  -h, --help   Show this help
`);
}

async function benchmarkAll(json: boolean, palette: Palette): Promise<void> {
  const version = readVersion();
  const startedAt = performance.now();
  const suites: SuiteResult[] = [];

  const runSuite = async (
    title: string,
    subtitle: string,
    fn: () => Promise<MetricResult[]>,
  ): Promise<void> => {
    const start = performance.now();
    const metrics = await fn();
    const suite: SuiteResult = {
      id: suites.length + 1,
      title,
      subtitle,
      metrics,
      durationMs: performance.now() - start,
    };
    suites.push(suite);
    if (!json) printSuite(palette, suite);
  };

  if (!json) printHeader(palette, version);

  await runSuite("Client Startup Latency", "cold start", benchmarkStartup);
  await runSuite("Queue Throughput", `${formatCount(100_000)} tracks`, () => benchmarkQueueOps(100_000));
  await runSuite("Queue Throughput", `${formatCount(1_000_000)} tracks`, () => benchmarkQueueOps(1_000_000));
  await runSuite("Event Dispatcher", `${formatCount(100_000)} events`, () => benchmarkEventDispatch(100_000));
  await runSuite("Event Dispatcher", `${formatCount(1_000_000)} events`, () =>
    benchmarkEventDispatch(1_000_000),
  );
  await runSuite("TrackEncoder", `${formatCount(50_000)} tracks`, () => benchmarkTrackEncoding(50_000));
  await runSuite("DSP FilterChain", `${formatCount(50_000)} cycles`, () => benchmarkFilterChain(50_000));

  const totalMs = performance.now() - startedAt;

  if (json) {
    console.log(
      JSON.stringify(
        {
          version,
          timestamp: new Date().toISOString(),
          runtime: runtimeName(),
          platform: process.platform,
          arch: process.arch,
          cores: coreCount(),
          cpu: cpus()[0]?.model.trim() ?? "unknown",
          warmedUp: true,
          totalMs,
          suites,
        },
        null,
        2,
      ),
    );
    return;
  }

  printSummary(palette, suites, totalMs);
}

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
} else {
  const json = args.has("--json");
  const palette = createPalette(!json && detectColor(args.has("--no-color")));
  await benchmarkAll(json, palette);
}
