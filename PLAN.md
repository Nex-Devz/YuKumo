# PLAN — Yukumo v1.8.0 DX Features

Target: `Yukumo wrapper` package. Pure TypeScript source, ships ESM + CJS + `.d.ts` via existing tsup config — **works in all JS runtimes** (Node ≥18, Bun, plain JS `require()` or `import`, no TS needed by consumers).

## Status of requested features

| # | Feature | Status |
|---|---------|--------|
| 1 | `player.waitUntilPlaying()` | ❌ ADD |
| 2 | `player.isVoiceReady` | ⚠️ partial — `hasVoiceCredentials`/`connected` exist; ADD `isVoiceReady` getter alias |
| 3 | `queue.lock(fn)` | ❌ ADD |
| 4 | `manager.players.find(criteria)` / `kumo.findPlayers()` | ❌ ADD |
| 5 | Node maintenance mode `node.setMaintenance(true)` | ❌ ADD |
| 6 | Temp player data w/ TTL `player.cache.set(k, v, ttlMs)` | ❌ ADD |
| 7 | `queue.move(from, to)` | ✅ **ALREADY EXISTS** — `src/queue/Queue.ts` `move()`. Skip. |
| 8 | `queue.unique()` | ❌ ADD |
| 9 | `manager.broadcast(fn)` | ❌ ADD |

## Implementation

### 1. `player.waitUntilPlaying(timeoutMs = 15000): Promise<void>`
- File: `src/player/Player.ts`
- Resolve immediately if `status === "playing"`.
- Else register waiter; resolve in `boundOnTrackStart`; reject on destroy or timeout (`PlayerError`).
- Waiter timer `unref()`ed. Same pattern as `voiceReadyWaiters`.

### 2. `player.isVoiceReady: boolean`
- Getter → `return this.hasVoiceCredentials && this._node.state === "connected"` (same as `connected`, DX-named).

### 3. `queue.lock<T>(fn: () => T | Promise<T>): Promise<T>`
- File: `src/queue/Queue.ts`
- Promise-chain mutex (same pattern as Player `_trackEndChain`): `_lockChain = _lockChain.then(run)`.
- Errors in `fn` propagate to caller but never break the chain.
- Add `queue.isLocked: boolean`.

### 4. `PlayerManager.find(criteria)` + `kumo.findPlayers(criteria)`
- File: `src/player/PlayerManager.ts`, facade in `src/Kumo.ts`
- Criteria (all optional, AND-combined):
  ```ts
  { node?: string; status?: PlayerStatus | PlayerStatus[]; voiceChannelId?: string;
    textChannelId?: string; autoplay?: boolean; stayInVc?: boolean; playing?: boolean;
    filter?: (p: Player) => boolean }
  ```
- Returns `Player[]`. Also `findOne(criteria)` → first match or `undefined`.

### 5. Node maintenance mode
- Files: `src/node/Node.ts`, `src/node/NodeSelector.ts`
- `node.setMaintenance(enabled: boolean)`, `node.maintenance: boolean` getter.
- All built-in selectors filter maintenance nodes out of `pick()` (single shared helper `eligibleNodes(nodes)` = connected && !maintenance).
- Existing players untouched → node drains naturally. Emit `debug` on toggle.
- `node.drain(): Promise<void>` (bonus): resolves once `playerCount === 0` (poll playerDestroy events).

### 6. `player.cache` — TTL map
- New file: `src/utils/TTLCache.ts`
- `class TTLCache { set(key, value, ttlMs?); get(key); has(key); delete(key); clear(); size }`
- Lazy expiry on read + per-entry `expiresAt`; no timers held (nothing keeps process alive).
- `Player.cache: TTLCache` replaces nothing — existing `player.data` Map stays for permanent data.
- Cleared in `destroy()`.

### 7. ~~`queue.move()`~~ — exists, skip.

### 8. `queue.unique(keyFn?)`
- File: `src/queue/Queue.ts`
- Default key: `track.encoded` fallback `track.info.identifier` fallback identity.
- Keeps first occurrence; never removes current track; fixes `currentIndex`; returns removed `T[]`; fires `onChanged`.

### 9. `kumo.broadcast(fn: (player) => void | Promise<void>): Promise<PromiseSettledResult<void>[]>`
- File: `src/Kumo.ts`
- `Promise.allSettled` over `players.getAll()` — one failing player never blocks the rest.
- Optional second arg: `findPlayers` criteria to broadcast to a subset:
  `kumo.broadcast(p => p.setVolume(80), { status: "playing" })`.

## Verification
1. `npx tsc --noEmit`
2. `npx vitest run` — new test file `src/DXFeatures.test.ts` covering all 8 additions
3. `npm run build` — confirm ESM + CJS + d.ts emit
4. CHANGELOG 1.8.0 entry + version bump

## Non-goals
- No breaking changes; all additive.
- `queue.move()` untouched.
