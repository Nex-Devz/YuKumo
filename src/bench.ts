/**
 * Benchmark measuring YuKumo startup latency, queue throughput,
 * event dispatching, and binary track encoding/decoding performance.
 *
 * Run: bun run src/bench.ts
 */
import { YuKumo } from "./YuKumo.ts";
import { Queue } from "./queue/Queue.ts";
import { EventDispatcher } from "./ws/EventDispatcher.ts";
import { encodeTrackInfo, decodeTrackInfo } from "./tracks/TrackEncoder.ts";
import { FilterChain } from "./filters/FilterChain.ts";
import type { TrackData, TrackInfo } from "./types/protocol.ts";

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

async function benchmarkStartup(): Promise<void> {
  const start = performance.now();
  const client = new YuKumo({
    nodes: [{ host: "localhost", port: 2333, password: "test" }],
  });
  const elapsed = performance.now() - start;
  console.log(`  YuKumo instance creation: ${elapsed.toFixed(2)}ms`);
  await client.destroy();
}

async function benchmarkQueueOps(count: number): Promise<void> {
  const queue = new Queue<TrackData>();
  const tracks = Array.from({ length: count }, (_, i) => makeTrack(i));

  const startEnqueue = performance.now();
  for (const track of tracks) {
    queue.enqueue(track);
  }
  const enqueueTime = performance.now() - startEnqueue;
  console.log(
    `  Enqueue ${count.toLocaleString()} tracks: ${enqueueTime.toFixed(2)}ms (${((count / enqueueTime) * 1000).toFixed(0)} ops/s)`,
  );

  let dequeued = 0;
  queue.start();
  const startDequeue = performance.now();
  while (queue.next() != null) {
    dequeued++;
  }
  const dequeueTime = performance.now() - startDequeue;
  console.log(
    `  Iterate ${dequeued.toLocaleString()} tracks: ${dequeueTime.toFixed(2)}ms (${((dequeued / dequeueTime) * 1000).toFixed(0)} ops/s)`,
  );

  // Shuffle benchmark
  const shuffleTracks = Array.from({ length: count }, (_, i) => makeTrack(i));
  const bigQueue = new Queue<TrackData>();
  for (const t of shuffleTracks) bigQueue.enqueue(t);

  const startShuffle = performance.now();
  bigQueue.shuffle();
  const shuffleTime = performance.now() - startShuffle;
  console.log(`  Shuffle ${count.toLocaleString()} tracks: ${shuffleTime.toFixed(2)}ms`);
}

async function benchmarkEventDispatch(count: number): Promise<void> {
  const dispatcher = new EventDispatcher();
  const handler = () => {
    /* noop */
  };

  const startRegister = performance.now();
  for (let i = 0; i < count; i++) {
    dispatcher.on("trackStart", handler);
  }
  const registerTime = performance.now() - startRegister;
  console.log(`  Register ${count.toLocaleString()} listeners: ${registerTime.toFixed(2)}ms`);

  dispatcher.removeAllListeners();
  dispatcher.on("trackStart", handler);

  const startEmit = performance.now();
  for (let i = 0; i < count; i++) {
    dispatcher.emit("trackStart", "guild", makeTrack(i));
  }
  const emitTime = performance.now() - startEmit;
  console.log(
    `  Emit ${count.toLocaleString()} events: ${emitTime.toFixed(2)}ms (${((count / emitTime) * 1000).toFixed(0)} ops/s)`,
  );
}

async function benchmarkTrackEncoding(count: number): Promise<void> {
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

  // Encode benchmark
  const startEncode = performance.now();
  let encodedSample = "";
  for (let i = 0; i < count; i++) {
    encodedSample = encodeTrackInfo(sampleInfo);
  }
  const encodeTime = performance.now() - startEncode;
  console.log(
    `  Encode ${count.toLocaleString()} tracks: ${encodeTime.toFixed(2)}ms (${((count / encodeTime) * 1000).toFixed(0)} ops/s)`,
  );

  // Decode benchmark
  const startDecode = performance.now();
  for (let i = 0; i < count; i++) {
    decodeTrackInfo(encodedSample);
  }
  const decodeTime = performance.now() - startDecode;
  console.log(
    `  Decode ${count.toLocaleString()} tracks: ${decodeTime.toFixed(2)}ms (${((count / decodeTime) * 1000).toFixed(0)} ops/s)`,
  );
}

async function benchmarkFilterChain(count: number): Promise<void> {
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

  const startSerialize = performance.now();
  for (let i = 0; i < count; i++) {
    chain.toPayload();
  }
  const serializeTime = performance.now() - startSerialize;
  console.log(
    `  Serialize FilterChain ${count.toLocaleString()} times: ${serializeTime.toFixed(2)}ms (${((count / serializeTime) * 1000).toFixed(0)} ops/s)`,
  );
}

async function benchmarkAll(): Promise<void> {
  console.log("\n=================== YuKumo Benchmarks ===================");

  console.log("\n[1. Client Startup Latency]");
  await benchmarkStartup();

  console.log("\n[2. Queue Throughput — 100k Tracks]");
  await benchmarkQueueOps(100_000);

  console.log("\n[3. Queue Throughput — 1M Tracks]");
  await benchmarkQueueOps(1_000_000);

  console.log("\n[4. Event Dispatcher Throughput — 100k Events]");
  await benchmarkEventDispatch(100_000);

  console.log("\n[5. Event Dispatcher Throughput — 1M Events]");
  await benchmarkEventDispatch(1_000_000);

  console.log("\n[6. TrackEncoder Binary Operations — 50k Tracks]");
  await benchmarkTrackEncoding(50_000);

  console.log("\n[7. DSP FilterChain Serialization — 50k Cycles]");
  await benchmarkFilterChain(50_000);

  console.log("\n=================== Benchmarks Complete ===================\n");
}

await benchmarkAll();
