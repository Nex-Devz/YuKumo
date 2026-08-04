# Changelog

All notable changes to the `yukumo` Lavalink client library will be documented in this file.

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
