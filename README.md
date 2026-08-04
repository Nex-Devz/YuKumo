<div align="center">

<h1>YuKumo</h1>

<p><i>A high-performance, framework-agnostic Lavalink v4 client for JavaScript and TypeScript.</i></p>

[![npm version](https://img.shields.io/npm/v/yukumo?color=F472B6&label=npm&style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/yukumo)
[![License: MIT](https://img.shields.io/badge/License-MIT-8B5CF6?style=for-the-badge)](LICENSE)
[![Lavalink v4](https://img.shields.io/badge/Lavalink-v4-1DB954?style=for-the-badge&logo=youtubemusic&logoColor=white)](https://lavalink.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Documentation](https://img.shields.io/badge/Docs-yukumo.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://yukumo.vercel.app)

</div>

<br />

YuKumo is a lightweight client library built to interface seamlessly with **Lavalink v4** audio servers. It treats JavaScript (CommonJS & ESM) and TypeScript as equal first-class targets — JSDoc-powered autocomplete for JS consumers, and strict, fully-generic typing with zero `any` for TS projects.

Built for production: multi-node load balancing, automatic failover, distributed state via Redis, and OpenMetrics observability out of the box.

**📖 Full documentation → [yukumo.vercel.app](https://yukumo.vercel.app)**

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [Plugins](#plugins)
- [Observability](#observability)
- [Reference Bots](#reference-bots)
- [Community](#community--contributing)
- [License](#license)

---

## Features

**Core Protocol & Caching**
- Full coverage of the Lavalink v4 REST API (search, decode, sessions, route planner, plugins) and WebSocket event dispatch
- `lavaSearch` support for concurrent multi-category queries — tracks, albums, artists, playlists, and text sources
- High-performance `SearchCache` LRU cache with configurable capacity (`maxSize`) and TTL support

**Node Management**
- 9 node-selection strategies: `RegionSelector`, `LeastUsed`, `LeastPenalty`, `CpuUsage`, `MemoryUsage`, `LowestPing`, `RoundRobin`, `Random`, and `CustomSelector`
- Zero-downtime automatic player migration on node disconnect or failure
- Built-in REST response caching with TTL, plus HTTP 429 `Retry-After` parsing and exponential backoff

**Queueing & Player Controls**
- Repeat modes (`off`, `track`, `queue`), play history, shuffle, and priority track injection via `priorityEnqueue`
- Advanced queue helpers: `swap()`, `skipTo()`, `removeRange()`, and `clearExceptCurrent()`
- Smart Autoplay recommendation engine (`setAutoplay()`) with `autoplayTrackAdded` event notifications
- Queue state serialization (`export()` / `import()`) and pagination (`getPage`)

**Audio & Filters**
- Full DSP filter chain: Equalizer, Karaoke, Timescale, Tremolo, Vibrato, Rotation, Distortion, ChannelMix, LowPass
- High-level presets: `setBassBoost()`, `setNightcore()`, `setVaporwave()`, `setSlowedReverb()`, `set3DAudio()`, `setPitchShift()`, `setVoiceIsolation()`
- Global custom named filter preset registry (`FilterChain.registerPreset()` / `applyPreset()`)

**Resilience & Protection** <sup>new in 1.6</sup>
- WebSocket heartbeat with pong-timeout detection — half-open dead node connections are terminated and auto-reconnected
- Error-rate protection (`maxErrorsPerTime`) destroys runaway players; `minAutoPlayMs` stops autoplay error spam
- `queueEmptyDestroyMs` auto-destroy timer after queue end, and standardized `DestroyReasons` on every `playerDestroy` event
- Interpolated `player.position` between server updates, plus `player.ping` (`{ ws, lavalink }`)

**Persistence** <sup>new in 1.6</sup>
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

**Control & Governance** <sup>new in 1.6</sup>
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

```js
const { YuKumo, LavaSrcPlugin, SponsorBlockPlugin } = require("yukumo");

const yukumo = new YuKumo({
  nodes: [{ host: "localhost", port: 2333, password: "youshallnotpass" }],
  plugins: [new LavaSrcPlugin(), new SponsorBlockPlugin()],
});
```

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

---

## Community & Contributing

- ⭐ **Showcase** — using YuKumo in production? Add your project to [SHOWCASE.md](SHOWCASE.md)
- 🤝 **Contributing** — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines
- 🛡️ **Security** — see [SECURITY.md](SECURITY.md) to report vulnerabilities
- 📖 **Docs** — [yukumo.vercel.app](https://yukumo.vercel.app)

---

## License

Distributed under the [MIT License](LICENSE).
