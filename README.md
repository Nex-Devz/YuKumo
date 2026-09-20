<div align="center">

<h1>YuKumo</h1>

<p><i>A high-performance, framework-agnostic Lavalink v4 client for JavaScript and TypeScript.</i></p>

[![npm version](https://img.shields.io/npm/v/yukumo?color=F472B6&label=npm&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/yukumo)
[![npm downloads](https://img.shields.io/npm/dm/yukumo?color=F472B6&label=downloads&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/yukumo)
[![CI](https://img.shields.io/github/actions/workflow/status/Nex-Devz/YuKumo/ci.yml?branch=master&label=CI&style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/Nex-Devz/YuKumo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-8B5CF6?style=for-the-badge)](LICENSE)
[![Lavalink v4](https://img.shields.io/badge/Lavalink-v4-1DB954?style=for-the-badge&logo=youtubemusic&logoColor=white)](https://lavalink.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/devz)
[![Documentation](https://img.shields.io/badge/Docs-yukumo.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://yukumo.vercel.app)

</div>

<br />

YuKumo is a lightweight client library built to interface seamlessly with **Lavalink v4** audio servers. It treats JavaScript (CommonJS & ESM) and TypeScript as equal first-class targets — JSDoc-powered autocomplete for JS consumers, and strict, fully-generic typing with zero `any` for TS projects.

Built for production: multi-node load balancing, automatic failover, distributed state via Redis, and OpenMetrics observability out of the box. YuKumo also speaks **NodeLink** — the NodeLink-specific REST endpoints, voice receiver, mixer, lyrics, and gapless playback are detected automatically and exposed with zero extra configuration.

**📖 Full documentation → [yukumo.vercel.app](https://yukumo.vercel.app)**

### Highlights

- 🎵 **Full Lavalink v4 coverage** — REST, WebSockets, route planner, plugins, and NodeLink extensions
- ⚡ **Zero-dependency player resuming** — audio keeps playing across bot restarts
- 🧩 **Plugin ecosystem** — LavaSrc, SponsorBlock, FloweryTTS, plus a custom plugin API
- 🛰️ **Multi-node by default** — 9 load-balancing strategies, automatic player migration, failover
- 💾 **State persistence** — queues and player snapshots survive restarts (Memory or Redis)
- 📊 **Observability** — Prometheus/OpenMetrics exporter, flexible loggers, pings, and penalties
- 📦 **Works without a server** — encode, decode, and build tracks entirely on the client

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [Plugins](#plugins)
- [NodeLink support](#nodelink-support)
- [Observability](#observability)
- [Reference Bots](#reference-bots)
- [FAQ](#faq)
- [Community](#community--contributing)
- [License](#license)

---

## Features

**Core Protocol & Caching**
- Full coverage of the Lavalink v4 REST API (search, decode, sessions, route planner, plugins) and WebSocket event dispatch
- `lavaSearch` support for concurrent multi-category queries — tracks, albums, artists, playlists, and text sources
- High-performance `SearchCache` LRU cache with configurable capacity (`maxSize`) and TTL support
- **Offline track encoding** — `Track.encode()`, `Track.decode()`, and `Track.build()` are byte-for-byte compatible with Lavalink v4's native format, so tracks can be encoded, decoded, and built entirely on the client with no server round-trip
- **Requester support** — pass a `requester` to `search()` and it's stamped onto every returned track's `userData` (surviving cache hits) and auto-exposed via `track.requester`

**Node Management**
- 9 node-selection strategies: `RegionSelector`, `LeastUsed`, `LeastPenalty`, `CpuUsage`, `MemoryUsage`, `LowestPing`, `RoundRobin`, `Random`, and `CustomSelector`
- Zero-downtime automatic player migration on node disconnect or failure
- Built-in REST response caching with TTL, plus HTTP 429 `Retry-After` parsing and exponential backoff

**Queueing & Player Controls**
- Repeat modes (`off`, `track`, `queue`) — including `setTrackRepeat()` / `setQueueRepeat()` and `trackRepeat` / `queueRepeat` booleans
- Play history, shuffle, and priority track injection via `priorityEnqueue`
- Advanced queue helpers: `swap()`, `skipTo()`, `removeRange()`, `clearExceptCurrent()`, and `player.get(start, end)` queue slicing
- Smart Autoplay recommendation engine (`setAutoplay()`) with `autoplayTrackAdded` event notifications
- Queue state serialization (`export()` / `import()`) and pagination (`getPage`)
- State getters in every convention: `status`, `isPlaying`, `isPaused`, `isConnected`, `isDestroyed`, `isAutoplay`, `voiceId`/`textId`, `currentTrack`

**Audio & Filters**
- Full DSP filter chain: Equalizer, Karaoke, Timescale, Tremolo, Vibrato, Rotation, Distortion, ChannelMix, LowPass, plus a raw `FiltersObject` passthrough in `setFilters()`
- High-level presets: `setBassBoost()`, `setNightcore()`, `setVaporwave()`, `setSlowedReverb()`, `set3DAudio()`, `setPitchShift()`, `setVoiceIsolation()`
- One setter per Lavalink filter band: `setEqualizer()`, `setKaraoke()`, `setTimescale()`, `setTremolo()`, `setVibrato()`, `setRotation()`, `setDistortion()`, `setChannelMix()`, `setLowPass()`, `setVolumeFilter()`
- Global custom named filter preset registry (`FilterChain.registerPreset()` / `applyPreset()`) and `setAudioOutput("mono" | "stereo" | "left" | "right")` routing
- Server-side filter-plugin passthrough via `setPluginFilter(name, settings)` — works with LavaDSPX and any Lavalink filter plugin (Lavalink v4 `pluginFilters`)

**Resilience & Protection**
- WebSocket heartbeat with pong-timeout detection — half-open dead node connections are terminated and auto-reconnected
- Error-rate protection (`maxErrorsPerTime`) destroys runaway players; `minAutoPlayMs` stops autoplay error spam
- `queueEmptyDestroyMs` auto-destroy timer after queue end, and standardized `DestroyReasons` on every `playerDestroy` event
- Interpolated `player.position` between server updates, plus `player.ping` (`{ ws, lavalink }`)

**Persistence**
- Queue persistence (`queueOptions.persist`): every queue mutation auto-saves to your `StorageAdapter` (Memory/Redis) and restores after a restart
- Full player state snapshots via `player.toJSON()`; queue change hook via `queue.onChanged`

**Voice State & Smart Behaviors**
- 24/7 Mode (`stayInVc`) to prevent channel disconnects on queue completion
- Smart empty voice channel monitor (`setVcMemberCount()`) with configurable auto-pause and auto-disconnect timeouts
- First-class gateway adapters for `discord.js` v14, `Eris`, `Seyfert`, `Oceanic.js`, `Davey`, and `Discordeno`

**Lyrics, SponsorBlock & DX Utilities**
- Server-side SponsorBlock plugin integration: `setSponsorBlock()` categories with `segmentsLoaded` / `segmentSkipped` / `chapterStarted` / `chaptersLoaded` events
- Live lyrics via the LavaLyrics plugin: `getCurrentLyrics()`, `subscribeLyrics()` with `lyricsLine` / `lyricsFound` / `lyricsNotFound` events
- Integrated LRCLIB synced lyrics (`getSyncedLyrics()`) with timestamp parser (`parseLrc()`)
- SponsorBlock segment skipping helper (`SponsorBlockClient`) for skipping sponsor sections, intros, and outros
- UI & Progress Bar helpers (`getProgressBar()`, `formatDuration()`, `createQueueEmbedData()`)
- Middleware interceptor registry (`MiddlewareRegistry` / `useBeforeTrackStart`)

**Control & Governance**
- Rich play options: `play(track, { position, endTime, noReplace, paused, volume })`
- Link policy: `linksAllowed`, `linksWhitelist`, `linksBlacklist` (string or RegExp) gate URL queries
- Custom HTTP headers per manager or per node; custom `Player` subclass via `playerClass`
- `player.moveNode()` least-loaded migration, `queue.sortBy()` / `queue.removeTrack()`, `setAudioOutput("mono" | "left" | "right")`, `parseLavalinkConnUrl()`

**Plugins**
- Pre-built wrappers for LavaSrc (Spotify, Apple Music, Deezer, Yandex Music), SponsorBlock segment filtering, and FloweryTTS

**Observability & Logging**
- `PrometheusExporter` for OpenMetrics-format output, ready for Grafana dashboards
- Flexible logging via `ConsoleLogger`, `NoopLogger`, `levelFilteredLogger`, or custom `Logger` implementations
- Drop-in `RedisStorage` adapter for sharded and multi-process deployments

---

## Installation

```bash
npm install yukumo
```

```bash
bun add yukumo
```

```bash
pnpm add yukumo
```

### Compatibility

| Target | Support |
|---|---|
| **Node.js** | 18.0.0+ (ESM & CommonJS) |
| **Lavalink** | v4.x (`lavalink.dev`) |
| **NodeLink** | `dev` branch — auto-detected, incl. voice receiver, mixer, lyrics & gapless |
| **Discord libraries** | `discord.js` v14, `Eris`, `Seyfert`, `Oceanic.js`, `Davey`, `Discordeno`, or a raw gateway adapter |
| **Bundlers** | Zero runtime dependencies (only `ws`) |

---

## Quick Start

```js
const { Client, GatewayIntentBits } = require("discord.js");
const { YuKumo, DiscordJSAdapter, LeastPenaltySelector } = require("yukumo");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const yukumo = new YuKumo({
  nodes: [{ host: "localhost", port: 2333, password: "youshallnotpass" }],
  defaultNodeSelector: new LeastPenaltySelector(),
});

const adapter = new DiscordJSAdapter(client, yukumo);

yukumo.on("nodeReady", (nodeId) => console.log(`[Yukumo] Node connected: ${nodeId}`));
yukumo.on("trackStart", (guildId, track) => console.log(`Now playing: ${track.info.title}`));

client.once("ready", async () => {
  yukumo.setUserId(client.user.id);
  await yukumo.init();
});

client.login(process.env.DISCORD_TOKEN);
```

---

## Usage Examples

<details>
<summary><b>CommonJS — full play command</b></summary>

```js
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith("!play ")) return;

  const query = message.content.slice(6).trim();
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.reply("Join a voice channel first!");

  const res = await yukumo.search(query);
  if (res.tracks.length === 0) return message.reply("No tracks found!");

  await yukumo.createPlayer({
    guildId: message.guild.id,
    voiceChannelId: voiceChannel.id,
    textChannelId: message.channel.id,
  });

  adapter.sendVoiceStateUpdate(message.guild.id, voiceChannel.id);
  await yukumo.play(message.guild.id, res.tracks[0]);
  message.reply(`Playing: ${res.tracks[0].info.title}`);
});
```

</details>

<details>
<summary><b>ESM</b></summary>

```js
import { Client, GatewayIntentBits } from "discord.js";
import { YuKumo, DiscordJSAdapter, LeastUsedSelector } from "yukumo";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const yukumo = new YuKumo({
  nodes: [{ host: "localhost", port: 2333, password: "youshallnotpass" }],
  defaultNodeSelector: new LeastUsedSelector(),
});

const adapter = new DiscordJSAdapter(client, yukumo);

client.once("ready", async () => {
  yukumo.setUserId(client.user.id);
  await yukumo.init();
});

client.login(process.env.DISCORD_TOKEN);
```

</details>

<details>
<summary><b>TypeScript — typed play command with filters</b></summary>

```ts
import { Client, GatewayIntentBits, Message } from "discord.js";
import { YuKumo, DiscordJSAdapter, TrackData, SearchResult, LeastPenaltySelector } from "yukumo";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const yukumo = new YuKumo({
  nodes: [{ host: "localhost", port: 2333, password: "youshallnotpass" }],
  defaultNodeSelector: new LeastPenaltySelector(),
});

const adapter = new DiscordJSAdapter(client, yukumo);

client.once("ready", async () => {
  if (!client.user) return;
  yukumo.setUserId(client.user.id);
  await yukumo.init();
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot || !message.guild || !message.member?.voice.channel) return;
  if (!message.content.startsWith("!play ")) return;

  const query = message.content.slice(6).trim();
  const searchRes: SearchResult = await yukumo.search(query);

  if (searchRes.tracks.length === 0) {
    await message.reply("No tracks found.");
    return;
  }

  const track: TrackData = searchRes.tracks[0];
  const player = await yukumo.createPlayer({
    guildId: message.guild.id,
    voiceChannelId: message.member.voice.channel.id,
    textChannelId: message.channel.id,
  });

  adapter.sendVoiceStateUpdate(message.guild.id, message.member.voice.channel.id);
  await yukumo.play(message.guild.id, track);
  player.filters.setBassBoost("medium");

  await message.reply(`Now playing: ${track.info.title}`);
});

client.login(process.env.DISCORD_TOKEN);
```

</details>

---

## Plugins

| Plugin | Description |
|---|---|
| **LavaSrc** | Spotify, Apple Music, Deezer, and Yandex Music resolution |
| **SponsorBlock** | Automatic segment filtering (intros, sponsors, outros) |
| **FloweryTTS** | Text-to-speech track generation |

LavaSrc, SponsorBlock, and FloweryTTS run **on the Lavalink node** (configured in its `application.yml`). The helpers below declare which of them your bot expects, so they show up in `manager.plugins`:

```js
const { YuKumo, createLavaSrcPlugin, createSponsorBlockPlugin } = require("yukumo");

const yukumo = new YuKumo({
  nodes: [{ host: "localhost", port: 2333, password: "youshallnotpass" }],
  plugins: [
    createLavaSrcPlugin({ spotify: { clientId: "…", clientSecret: "…" } }),
    createSponsorBlockPlugin({ categories: ["sponsor", "intro", "outro"] }),
  ],
});
```

Runtime SponsorBlock skip categories and youtube-source poToken/OAuth are set per-node via `player.setSponsorBlock()` and `node.rest.setYouTubePoToken()` / `setYouTubeRefreshToken()`.

---

## NodeLink support

Yukumo connects to a Lavalink v4 node, a NodeLink node, or **both at once in one pool** with the
same API. The server family is detected from `/v4/info` on connect (or forced via
`type`), and each node exposes what it can do so NodeLink-only features never
accidentally run on a plain Lavalink node.

```js
const { YuKumo, createLavalinkNode, createNodeLinkNode } = require("yukumo");

const kumo = new YuKumo({
  nodes: [
    createLavalinkNode({ host: "ll.example", port: 2333, password: "pw" }),
    createNodeLinkNode({ host: "nl.example", port: 2333, password: "pw" }),
  ],
  send: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload),
});

// After a node is ready:
node.type;              // "lavalink" | "nodelink"
node.version;           // server version string
node.sourceManagers;    // e.g. ["youtube", "soundcloud", "bandcamp", ...]
node.supports("lyrics");        // true on NodeLink
node.supports("voiceReceive");  // true on NodeLink
node.supportsFilter("echo");    // NodeLink extra filter
```

**Capability-aware routing.** Feature requests only go to a node that can serve them:

```js
// Routed to a lyrics-capable node automatically in a mixed pool
const lyrics = await kumo.getLyrics(encodedTrack);

// Pick a node for a specific capability yourself
const node = kumo.nodes.pick(guildId, { feature: "voiceReceive" });
```

If no connected node supports a requested feature, Yukumo throws a typed
`YukumoUnsupportedFeatureError` (`code: "UNSUPPORTED_FEATURE"`, with `feature`, `nodeId`,
`nodeType`) instead of failing silently. `node.assertSupports(feature)` does the same on demand.

**Feature / capability matrix:**

| Feature | Lavalink v4 | NodeLink |
|---|:---:|:---:|
| Playback, queue, standard filters | ✅ | ✅ |
| Session resume, route planner | ✅ | ✅ |
| Extra DSP filters (`echo`, `chorus`, `compressor`, `phaser`, `highpass`, `flanger`, `reverb`, `spatial`, `phonograph`, `tesseract`) | ❌ | ✅ |
| Built-in lyrics (`getLyrics`, `loadLyrics`) + live lyrics subscribe | plugin | ✅ native |
| Chapters (`player.getChapters`), meaning (`getTrackMeaning`) | ❌ | ✅ |
| Voice receive (`node.createVoiceReceiver`) | ❌ | ✅ |
| Direct/raw stream, mixer layers, sync groups | ❌ | ✅ |
| youtube-source poToken / OAuth config | plugin | ✅ |

**Cross-family failover.** When a player moves between a NodeLink node and a Lavalink node,
filters the target can't run (NodeLink extras) are dropped automatically with a `debug` log — audio
keeps playing rather than erroring.

**NodeLink extra filters** are applied through the same API as standard ones:

```js
await player.setEcho({ delay: 200, feedback: 0.4 });
await player.setReverb({ roomSize: 0.8, damping: 0.5 });
```

> Detection is automatic. Use `createNodeLinkNode()` / `type: "nodelink"` only to skip the
> `/v4/info` round-trip or to force a family. NodeLink is a **server**; Yukumo has no dependency on
> it and copies none of its code.

---

## Observability & Logging

Export live node and player metrics in OpenMetrics format for Prometheus / Grafana:

```js
const { PrometheusExporter } = require("yukumo");

const exporter = new PrometheusExporter(yukumo);
exporter.listen(9090); // scrape at :9090/metrics
```

Configure custom loggers (`ConsoleLogger`, `NoopLogger`, or `levelFilteredLogger`) and LRU search caching:

```js
const { YuKumo, ConsoleLogger, levelFilteredLogger, SearchCache } = require("yukumo");

const yukumo = new YuKumo({
  nodes: [{ host: "localhost", port: 2333, password: "youshallnotpass" }],
  logger: levelFilteredLogger(new ConsoleLogger(), "info"),
  searchCache: new SearchCache({ maxSize: 200, ttl: 1800000 }), // 30 min TTL
});
```

Scale horizontally across processes with the built-in `RedisStorage` adapter.

---

## Reference Bots

Complete, runnable bot implementations live in [`examples/`](examples):

| Bot | Description |
|---|---|
| [`examples/js-cjs/bot.js`](examples/js-cjs/bot.js) | CommonJS JavaScript |
| [`examples/js-esm/bot.js`](examples/js-esm/bot.js) | ESM JavaScript |
| [`examples/ts/bot.ts`](examples/ts/bot.ts) | TypeScript |
| [`examples/discordjs`](examples/discordjs) | discord.js v14 (slash commands) |
| [`examples/eris`](examples/eris) | Eris |
| [`examples/seyfert`](examples/seyfert) | Seyfert |
| [`examples/oceanic`](examples/oceanic) | Oceanic.js |
| [`examples/discordeno`](examples/discordeno) | Discordeno |

---

## FAQ

**Do I need a Lavalink server to use Yukumo?**
Yes for playback — Yukumo is a client for Lavalink v4 (or NodeLink). You can,
however, encode, decode, and build tracks entirely on the client with no server
using `Track.encode()` / `Track.decode()` / `Track.build()`.

**Does Yukumo work with NodeLink?**
Yes — as a first-class node type. NodeLink is auto-detected from `/v4/info`; its extra REST
endpoints, voice receiver, mixer, native lyrics/chapters, extra DSP filters, and gapless playback
are exposed automatically. Lavalink and NodeLink nodes can share one pool, and feature requests are
routed to a capable node. Force the family with `type: "nodelink"` / `createNodeLinkNode()`. See
[NodeLink support](#nodelink-support).

**Which Discord libraries are supported?**
First-class adapters ship for `discord.js` v14, `Eris`, `Seyfert`, `Oceanic.js`,
`Davey`, and `Discordeno`, plus a raw gateway adapter for anything else.

**Does it support CommonJS and ESM?**
Both. The package ships an `exports` map with ESM, CJS, and type declarations.

**How do I run multiple nodes / load balance?**
Pass multiple entries in `nodes` and pick a strategy via `defaultNodeSelector`
(e.g. `LeastPenaltySelector`, `RoundRobinSelector`, `CustomSelector`). Players
migrate automatically on node disconnect or failure.

**Does state survive a bot restart?**
With `resuming` enabled, session IDs and player snapshots persist (Memory or
Redis) and are restored on `init()` — a live resumed session is adopted with no
audio gap.

---

## Community & Contributing

- ⭐ **Showcase** — using YuKumo in production? Add your project to [SHOWCASE.md](SHOWCASE.md)
- 🤝 **Contributing** — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines
- 🛡️ **Security** — see [SECURITY.md](SECURITY.md) to report vulnerabilities
- 📖 **Docs** — [yukumo.vercel.app](https://yukumo.vercel.app)

---

## License

Distributed under the [MIT License](LICENSE).
