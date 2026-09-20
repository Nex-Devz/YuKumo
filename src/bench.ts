/**
 * Quick benchmark measuring YuKumo startup time and queue performance.
 *
 * Run: bun run src/bench.ts
 */
import { YuKumo } from "./Kumo.ts";
import { Queue } from "./queue/Queue.ts";
import { EventDispatcher } from "./ws/EventDispatcher.ts";
import type { TrackData } from "./types/protocol.ts";

function makeTrack(id: number): TrackData {
  return {
    encoded: `bench-${id}`,
    info: {
      identifier: `id-${id}`,
      isSeekable: true,
      author: "bench",
      length: 300000,
      isStream: false,
      position: 0,
      title: `Bench Track ${id}`,
      uri: null,
      artworkUrl: null,
      isrc: null,
      sourceName: "bench",
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
    `  Enqueue ${count} tracks: ${enqueueTime.toFixed(2)}ms (${((count / enqueueTime) * 1000).toFixed(0)} ops/s)`,
  );

  let dequeued = 0;
  queue.start();
  const startDequeue = performance.now();
  while (queue.next() != null) {
    dequeued++;
  }
  const dequeueTime = performance.now() - startDequeue;
  console.log(
    `  Iterate ${dequeued} tracks: ${dequeueTime.toFixed(2)}ms (${((dequeued / dequeueTime) * 1000).toFixed(0)} ops/s)`,
  );

  // shuffle benchmark
  const shuffleTracks = Array.from({ length: count }, (_, i) => makeTrack(i));
  const bigQueue = new Queue<TrackData>();
  for (const t of shuffleTracks) bigQueue.enqueue(t);

  const startShuffle = performance.now();
  bigQueue.shuffle();
  const shuffleTime = performance.now() - startShuffle;
  console.log(`  Shuffle ${count} tracks: ${shuffleTime.toFixed(2)}ms`);
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
  console.log(`  Register ${count} listeners: ${registerTime.toFixed(2)}ms`);

  dispatcher.removeAllListeners();
  dispatcher.on("trackStart", handler);

  const startEmit = performance.now();
  for (let i = 0; i < count; i++) {
    dispatcher.emit("trackStart", "guild", makeTrack(i));
  }
  const emitTime = performance.now() - startEmit;
  console.log(
    `  Emit ${count} events: ${emitTime.toFixed(2)}ms (${((count / emitTime) * 1000).toFixed(0)} ops/s)`,
  );
}

async function benchmarkAll(): Promise<void> {
  console.log("\n=== YuKumo Benchmarks ===\n");

  console.log("[Startup]");
  await benchmarkStartup();

  console.log("\n[Queue — 100k items]");
  await benchmarkQueueOps(100_000);

  console.log("\n[Queue — 1M items]");
  await benchmarkQueueOps(1_000_000);

  console.log("\n[Event Dispatcher — 100k]");
  await benchmarkEventDispatch(100_000);

  console.log("\n[Event Dispatcher — 1M]");
  await benchmarkEventDispatch(1_000_000);

  console.log("\n=== Done ===");
}

await benchmarkAll();
