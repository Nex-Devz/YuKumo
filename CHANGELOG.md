# Changelog

All notable changes to the `yukumo` Lavalink client library will be documented in this file.

## [Unreleased]

### Added
- **First-class NodeLink support (mixed pools)**: connect to Lavalink, NodeLink, or both at once with one API.
  - `NodeConfig.type: "lavalink" | "nodelink" | "auto"` (default `"auto"`, detected from `/v4/info`); legacy `isNodeLink` still honored. `createNodeLinkNode()` / `createLavalinkNode()` config helpers.
  - `node.type`, `node.version`, `node.capabilities`, `node.sourceManagers` getters resolved on `ready`.
  - Capability system: `node.supports(feature)`, `node.supportsFilter(name)`, `node.assertSupports(feature)` over a `NodeFeature` union (`lyrics`, `chapters`, `meaning`, `voiceReceive`, `extraFilters`, `stream`, `mixer`, `sponsorblock`, `lyricsSubscribe`, `groups`, `youtubeConfig`, `routeplanner`, `sessionResume`). NodeLink's enabled filter/source sets are read from `/v4/info`.
  - `YukumoUnsupportedFeatureError` (`code: "UNSUPPORTED_FEATURE"`) thrown instead of failing silently when a feature isn't available on the connected node.
  - Capability-aware selection: `NodeManager.pick(guildId, { feature })` filters candidates by capability; `kumo.getLyrics()` routes to a lyrics-capable node in a mixed pool.
  - Cross-family failover: `Player.setNode()` drops filters the target node can't run (NodeLink extras onto Lavalink) with a debug log, so moves degrade gracefully instead of erroring.
- **Server-side plugin filters (LavaDSPX & any filter plugin)**: `player.setPluginFilter(name, settings)` and `FilterChain.setPluginFilter()` / `getPluginFilter()` / `hasPluginFilter()` pass arbitrary filter-plugin settings through Lavalink v4's `pluginFilters` (e.g. LavaDSPX `highPass`, `lowPass`, `normalization`, `echo`). Settings are serialized untouched and round-trip through `apply()` / `toPayload()`; pass `false`/`null` to remove.
- **youtube-source plugin config**: `RestClient.getYouTubeStatus()`, `setYouTubePoToken(poToken, visitorData)`, and `setYouTubeRefreshToken(refreshToken?, skipInitialization?)` drive the youtube-source plugin's poToken/OAuth at the server root to bypass YouTube bot-detection.
- **`Player.skipTo(index)`**: player-level jump that starts the target queue track on the node, so the queue cursor never points at a not-yet-played track while old audio is still running (skipped tracks go to history).
- **Typed server-plugin markers**: `createLavaSrcPlugin()` / `createSponsorBlockPlugin()` / `createFloweryTTSPlugin()` return `ServerPluginMarker` objects that record their intended options and expose `isServerPlugin`, so `manager.plugins.get(name)` can introspect them (previously silent no-ops).
- **Full NodeLink Protocol Support**: the client now speaks NodeLink's full protocol, not just the Lavalink subset.
  - **NodeLink routing**: `getVersion()` hits NodeLink's root `/version`; session resuming is enabled for NodeLink nodes (supported since NodeLink v3) instead of being skipped.
  - **SponsorBlock**: `player.setSponsorBlock(state)` / `getSponsorBlock()` / `deleteSponsorBlock()` now route to NodeLink's `/sessions/:id/players/:guildId/sponsorblock` endpoint, plus new `getSponsorBlockState()`, `setSponsorBlockOptions()` (PATCH — `enabled`, `categories`, `actionTypes`, `skipMarginMs`) and `setSponsorBlockSegments()` (POST) methods.
  - **UpdatePlayer extensions**: `loudnessNormalizer`, `ducking`, `crossfade`, expanded `fading` (`{ trackStart | trackEnd | trackStop | seek | pause | resume | ducking }` with `type: "volume" | "tape" | "scratch" | "both"` and `curve: linear | exponential | logarithmic | s-curve`), and `track.audioTrackId` / `track.language`. `setFading()` accepts the new `FadingSettings` shape; new `setLoudnessNormalizer()`, `setDucking()`, `setCrossfade()`.
  - **New NodeLink filters**: `setEcho()`, `setChorus()`, `setCompressor()`, `setPhaser()`, `setHighPass()`, `setFlanger()`, `setReverb()`, `setSpatial()`, `setPhonograph()`, `setTesseract()` (all built on a shared `NodeLinkFilter` base and applied by `FilterChain`).
  - **Streaming & audio**: `loadStream(identifier)` (raw PCM `audio/l16`), `getTrackStream(encodedTrack, itag?)` (resolves a direct stream URL), `encodeTrack()` / `encodeTracks()` (server-side encoding for offline-built tracks).
  - **Metrics, workers & YouTube**: `getNodeMetrics()` (Prometheus text), `getWorkers()` / `killWorker(id)`, `getYouTubeConfig()` / `setYouTubeConfig()`, `getYouTubeOAuth()` / `refreshYouTubeOAuth()`.
  - **Multi-guild sync groups**: `getGroups()` / `createGroup()` / `getGroup(id)` / `updateGroup(id, body)` / `deleteGroup(id)` on `/v4/sessions/:id/groups`.
  - **Voice receive rewrite**: `NodeLinkVoiceReceiver` now connects to `/v4/websocket/voice/:guildId` and parses NodeLink's binary frame protocol (op `start`/`stop`/`data`, formats opus/ogg/pcm_s16le, real-time DSP capture via `data` event with `ssrc`/`timestamp`). Legacy JSON `speak` messages still handled. Auto-reconnect with backoff, `connect()` promise, `close()`/`destroy()`.
  - **NodeLink events**: `volumeChanged`, `playerSeek`, `playerPause`, `filtersChanged`, `streamMetadata`, `workerFailed`, `playerConnected`, `playerReconnecting` forwarded globally (plus debug-forwarded `playerCreated`/`playerDestroyed`/`connectionStatus`/eternal-box events).
  - **Source prefixes**: NodeLink source prefixes mapped in `search()` — `tidal`/`tdsearch`, `bandcamp`/`bcsearch`, `bilibili`/`bilisearch`, `nicovideo`/`ncsearch`, `netease`/`ntsearch`, `jiosaavn`/`jssearch`, `anghami`/`agsearch`, `audius`/`ausearch`, `mixcloud`/`mcsearch`, `vkmusic`/`vksearch`, `lastfm`/`lfsearch`, `qobuz`/`qbsearch`, `googledrive`/`gdsearch`, `shazam`/`shsearch`, `gaana`/`gnsearch`, `pandora`/`pdsearch`, `iheartradio`/`ihsearch`, `amazonmusic`/`azsearch`, `yandexmusic`/`ymsearch`, and more.

### Fixed
- **Event dispatcher safety**: `emit()` iterates a snapshot of the listener list — listeners added or removed during an emit are no longer invoked mid-loop (and once-listeners removed during the same emit don't fire twice).
- **`NodeManager.setUserId()`** now actually updates the manager's user id and propagates it to all nodes (previously a no-op via a `(this as any)` cast).
- **Player status rollback**: if `playTrack()` fails on top of an already-playing track, the status is restored to `"playing"` (not incorrectly left as `"idle"`).
- **Node penalties**: CPU load now prefers `cpu.lavalinkLoad` and falls back to NodeLink's `cpu.nodelinkLoad`; missing load metrics can no longer produce `NaN` penalties.
- **NodeLink resuming**: `/v4/info` detection now also propagates to the `RestClient`, so `getVersion()` and NodeLink-only REST calls route correctly.
- **Voice handling**: Discord close code `4014` is recognized as an auto-reconnect; stale voice credentials are cleared (`Player.resetVoiceState()`) before the bot rejoins after a disconnect.
- **Voice-state filter**: `VOICE_STATE_UPDATE` events from non-bot users can no longer destroy a player when the bot's user id is empty.
- **Search results**: NodeLink playlist responses keep the server's `selectedTrack` index (`playlistInfo.selectedTrack`).
- **Concurrent `connect()`**: a second `WebSocketClient.connect()` while one is in flight now returns the same pending promise, so all callers await the real socket open (or failure) instead of resolving optimistically.
- **Typed event forwarding**: the manager's node-event and plugin-event re-emit paths are fully typed against the public `EventMap`; the internal `as any` / `as never` / `as EventName` casts were removed.

### Changed
- **Zero-warning lint**: the WebSocket client, framework adapters, REST client, and lyrics client no longer use `any`; a shared `isVoicePacket()` type guard replaces per-adapter packet checks, and `npm run lint` is clean with zero warnings.

## [1.8.0] - 2026-08-19

### Added
- **Offline Track Encoding**: `Track.encode(info)`, `Track.decode(encoded)`, and `Track.build(info, requester?)` are byte-for-byte compatible with Lavalink v4's native encoding (`@lavalink/encoding`) — build, encode, and decode tracks entirely on the client with no server round-trip. Also exported: `encodeTrackInfo()` / `decodeTrackInfo()`.
- **Requester Support**: `kumo.search({ query, requester })` (and the `requester` field on `SearchOptions`) stamps the requester onto every returned track's `userData` — cache hits included, without polluting the shared cache. `Track.requester` now auto-populates from `userData.requester`.
- **Player State Getters**: `isPlaying`, `isPaused`, `isConnected`, `isDestroyed`, `isAutoplay`.
- **Repeat-Mode Aliases**: `setTrackRepeat(enabled)` / `setQueueRepeat(enabled)` plus `trackRepeat` / `queueRepeat` boolean getters/setters that never clobber the other repeat mode.
- **Per-Filter Setters**: `player.setEqualizer()`, `setKaraoke()`, `setTimescale()`, `setTremolo()`, `setVibrato()`, `setRotation()`, `setDistortion()`, `setChannelMix()`, `setLowPass()`, `setVolumeFilter()`. `player.setFilters()` now also accepts a raw Lavalink `FiltersObject` in addition to a `FilterChain`.
- **Queue Slicing**: `player.get(start, end)` returns a queue slice (current track included).
- **Duration Utils**: `parseDuration("3:32")` → ms. `formatDuration()` consolidated into `UIHelpers` and reused by `Track.durationFormatted`.

## [1.7.0] - 2026-08-06

### Added
- **Session Resuming Across Restarts**: `ManagerOptions.resuming` (`{ enabled, timeout = 60, persistPlayers = true }`). Session IDs are persisted per node (`yukumo:session:<nodeId>`) and seeded pre-connect via the new `WebSocketClient.setSessionId()`, so a restarted bot reclaims its Lavalink sessions — **audio keeps playing through the restart**. `NodeConfig.resuming` enables it per node (Session-Id header no longer requires `resumeKey`).
- **Player Restore ("keep playing")**: with `resuming.persistPlayers`, every player persists a full snapshot (`yukumo:player:<guildId>` — queue, position, volume, filters, repeat/autoplay/24-7 flags; refreshed on trackStart, every playerUpdate ~5s, queue mutations, and playback setters). `init()` calls `restorePlayers()`: on a resumed session the still-live server-side player is **adopted silently** (`adoptLiveState()` — no play request, zero audio gap); otherwise the bot rejoins voice and replays at the saved position. New `playerRestored (guildId, resumedLive)` event; new `Player.saveState()` / `restoreFromState()` / `enableStatePersistence()`. `YuKumo.destroy()` flushes final snapshots before teardown.
- **Source-Aware Autoplay (all sources)**: default autoplay is no longer YouTube-only. `Player.resolveAutoplayTrack()` picks recommendation strategies per `sourceName` — YouTube/YT Music RD mix, Spotify `sprec:seed_tracks=`, Deezer `dzrec:`, Yandex `ymrec:`, SoundCloud `/recommended` — then falls back to `scsearch`/`amsearch`/`ytsearch` on artist + title. Recently played tracks (history + current) are excluded to prevent loops. `playerDefaults.autoplay` enables autoplay on every created player; custom `autoplayFetcher` still overrides.
- **NodeLink Support**: auto-detected from `/v4/info` (`isNodelink`) or forced via `NodeConfig.isNodeLink`; `node.isNodeLink` / `player.isOnNodeLink` getters. Session resuming is automatically skipped on NodeLink (unsupported there — reconnects re-send player state instead). `getLyrics()` transparently routes to NodeLink's built-in `/v4/loadlyrics`. NodeLink's `SponsorBlockSegmentsLoadedEvent`/`SponsorBlockSegmentSkippedEvent` map to the existing `segmentsLoaded`/`segmentSkipped` events.
- **NodeLink Extra Features**:
  - REST: `loadLyrics(encoded, lang?)`, `loadChapters(encoded)`, `getMeaning(encoded)`, `getConnectionMetrics()`, mixer CRUD (`addMixLayer` / `getMixLayers` / `updateMixLayer` / `removeMixLayer` on `/v4/sessions/:id/players/:guildId/mix`).
  - Player: `getNodeLinkLyrics(lang?)`, `getChapters()`, `getTrackMeaning()`, `setGaplessNext(track | null)` (gapless preload via `nextTrack`), `setFading({ trackStart | trackEnd | trackStop | seek | ducking: { duration, curve } })` (curves: linear, exponential, logarithmic, s-curve), mixer helpers.
  - Voice receive: `NodeLinkVoiceReceiver` (`node.createVoiceReceiver(guildId)` / `player.createVoiceReceiver()`) — connects to `/connection/data`, emits `startSpeaking` and `endSpeaking` with base64 opus/pcm captured audio.
  - Events: `mixStarted` / `mixEnded` (MixStartedEvent/MixEndedEvent) forwarded globally and per player.
  - `updatePlayer()` accepts NodeLink extensions: `nextTrack`, `fading`, `track.audioTrackId`.
- `LavalinkInfo` gains `isNodelink` / `node` fields.
- **DX Utilities**:
  - `player.waitUntilPlaying(timeoutMs = 15000)` — resolves when the node reports the track actually started (no manual `trackStart` listener); resolves immediately when already playing, rejects on destroy/timeout.
  - `player.isVoiceReady` getter — voice credentials held + node connected; pairs with `waitForVoiceReady()`.
  - `queue.lock(fn)` — promise-chain mutex serializing multi-step queue edits (add + shuffle) against concurrent commands; `queue.isLocked` getter. Errors propagate without breaking the chain.
  - `queue.unique(keyFn?)` — removes duplicate tracks (default key: `encoded` → `info.identifier`), keeps first occurrence, never removes the playing track, returns removed tracks.
  - `players.find(criteria)` / `players.findOne(criteria)` / `kumo.findPlayers(criteria)` — filter by `node`, `status` (single or array), `voiceChannelId`, `textChannelId`, `autoplay`, `stayInVc`, `playing`, or custom `filter` predicate.
  - **Node maintenance mode** — `node.setMaintenance(true)`: load balancers assign no new players, existing players keep playing, node drains naturally; `node.maintenance` getter and `node.drain(timeoutMs?, pollMs?)` which resolves at zero players. Safe node restarts for hosting providers.
  - `player.cache` — per-player `TTLCache` (`cache.set("vote", true, 60_000)` auto-expires); lazy expiry, no timers held; cleared on destroy. `TTLCache` exported. Permanent values stay on `player.data`.
  - `kumo.broadcast(fn, criteria?)` — applies an operation to all (or criteria-matched) players via `Promise.allSettled`; one failing player never blocks the rest.

### Changed
- `pause()`, `resume()`, `setVolume()`, `setLoop()`, `setAutoplay()` now schedule a state snapshot when state persistence is on.
- Queue persistence and state persistence share the `Queue.onChanged` hook (both fire on mutations).

## [1.6.0] - 2026-08-04

### Added
- **Queue Persistence**: `queueOptions.persist` auto-saves every queue to the configured `StorageAdapter` (microtask-coalesced) and restores it on `createPlayer()`. Persisted queues survive restarts — kept on shutdown (`DisconnectAllNodes`), deleted on normal destroys. New `Player.enableQueuePersistence()` / `Player.restoreQueue()` and a `Queue.onChanged` mutation hook.
- **WebSocket Heartbeat**: ping/pong dead-connection detection per node (`enableHeartbeat`, `heartbeatIntervalMs` = 30000, `heartbeatTimeoutMs` = 10000). Half-open sockets are terminated and reconnect automatically; new `ws.isAlive` getter.
- **SponsorBlock Plugin Integration**: `player.setSponsorBlock(categories)` / `getSponsorBlock()` / `deleteSponsorBlock()` plus `segmentsLoaded`, `segmentSkipped`, `chaptersLoaded`, `chapterStarted` events (server-side auto-skip via the Lavalink SponsorBlock plugin).
- **Live Lyrics (LavaLyrics)**: `player.getCurrentLyrics()`, `subscribeLyrics()`, `unsubscribeLyrics()` plus `lyricsFound`, `lyricsNotFound`, `lyricsLine` events.
- **Play Options**: `play()` / `playTrack()` now accept `{ position, endTime, noReplace, paused, volume }`.
- **Player Protections** (defaults via `ManagerOptions.playerDefaults`): `maxErrorsPerTime` sliding-window error-rate destroy (`{ threshold: 35000, maxAmount: 3 }`), `minAutoPlayMs` autoplay error-spam guard (10000ms), `queueEmptyDestroyMs` destroy-after-queue-end timer.
- **Destroy Reasons**: `DestroyReasons` enum; `destroy(reason)` everywhere and `playerDestroy` event now emits `(guildId, reason)`.
- **Link Policy**: `linksAllowed`, `linksWhitelist`, `linksBlacklist` (string substring or RegExp) gate URL queries in `search()`.
- **Custom HTTP Headers**: `ManagerOptions.httpHeaders` (global) and `NodeConfig.httpHeaders` (per node) applied to REST requests and the WS handshake.
- **Player API**: `toJSON()` full state snapshot, `ping` getter `{ ws, lavalink }`, `moveNode(nodeId?)` least-loaded auto-pick.
- **Queue API**: `sortBy("duration" | "title" | "author" | comparator, order)`, `removeTrack(track | tracks | predicate)`.
- **Filters**: `setAudioOutput("mono" | "stereo" | "left" | "right")` channel-mix presets (`AudioOutputs` export).
- **Custom Player Class**: `ManagerOptions.playerClass` lets you extend `Player`.
- **Utils**: `parseLavalinkConnUrl("lavalink://name:pass@host:port")`.

### Fixed
- Player leak: direct `player.destroy()` (auto-disconnect, channel delete) now unregisters from `PlayerManager` and decrements `node.playerCount`.
- Race: track-end handling (natural end / stuck / skip) is serialized — no more double queue-advances.
- `position` now interpolates between `playerUpdate` frames (clamped to track length) instead of being up to ~5s stale; `seek()` clamps to `[0, length]`.
- `resume()` on an idle player no longer fakes `"playing"`; `pause()`/`resume()` are idempotent.
- `setVolume()` is remembered while the node session is down and applied on next play.
- `skip()` with nothing playing no longer crashes the autoplay path.
- Empty-VC and queue-empty timers are `unref()`ed — they no longer keep the process alive.

## [1.4.0] - 2026-08-01

### Added
- **Smart Autoplay Engine**: Added `setAutoplay(enabled, fetcher?)`, `isAutoplayEnabled()`, and `autoplayTrackAdded` event emission on recommendation track enqueues.
- **Extended Queue Operations**: Added `Queue.swap(indexA, indexB)`, `Queue.skipTo(index)`, `Queue.removeRange(start, count)`, and `Queue.clearExceptCurrent()`.
- **Audio DSP Presets**: Added `setSlowedReverb()`, `set3DAudio()`, `setPitchShift()`, `setVoiceIsolation()`, and global custom preset registry (`FilterChain.registerPreset()` & `applyPreset()`).
- **Smart Voice Channel Behaviors**: 24/7 mode (`stayInVc`) and empty voice channel monitor (`setVcMemberCount()`) with configurable auto-pause and auto-disconnect timeouts.
- **Synced Lyrics & SponsorBlock**: `getSyncedLyrics()` helper using LRCLIB API with timestamp parser (`parseLrc()`) and `SponsorBlockClient` segment auto-skipping.
- **Developer Experience & UI Helpers**: `getProgressBar()`, `formatDuration()`, `createQueueEmbedData()`, and `MiddlewareRegistry` interceptor hooks (`useBeforeTrackStart`).

### Fixed
- Voice connection handshake race condition: added `waitForVoiceReady()` promise.
- Session resumption on WebSocket reconnect: re-sends OP4 voice credentials and player states.
- Handled `WebSocketClosedEvent` auto-reconnects on Discord close codes 4009 / 4015.
- Voice endpoint handling: preserved active endpoint when receiving `null` endpoints during Discord region failovers.
