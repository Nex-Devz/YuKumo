## Summary of Changes

<!-- Provide a concise description of what this PR changes, why it is needed, and any issue it resolves. -->

Closes # <!-- issue number if applicable -->

## Type of Change

- [ ] **Bug fix** (non-breaking change resolving an issue)
- [ ] **New feature** (non-breaking feature addition or protocol extension)
- [ ] **Breaking change** (fix or feature that would cause existing functionality to change)
- [ ] **Protocol update** (Lavalink v4 / NodeLink REST or WebSocket payload adjustment)
- [ ] **Adapter enhancement** (discord.js, Eris, Seyfert, Oceanic, Davey, or Discordeno)
- [ ] **Documentation / Examples** (clarification, guide addition, or fix)
- [ ] **Performance / Maintenance** (refactor, memory optimization, build tooling)

## Protocol & Compatibility Matrix

- [ ] **Lavalink v4 Compatibility**: Does this change maintain full compliance with the Lavalink v4 specification?
- [ ] **NodeLink Compatibility**: If NodeLink-specific features are introduced or modified, are they guarded by `node.supports()` or handled with cross-family failover?
- [ ] **Session Resuming**: If modifying connection lifecycles or player states, does session reclaiming continue to work without audio interruption?
- [ ] **Offline Track Operations**: If modifying track fields or encoding logic, does `TrackEncoder` maintain byte-level parity with `@lavalink/encoding`?

## Engineering Checklist

- [ ] Code strictly follows TypeScript standards with zero `any` declarations.
- [ ] All new or modified logic is covered by unit tests in `src/`.
- [ ] Local verification commands pass cleanly:
  - [ ] `npm run typecheck`
  - [ ] `npm run lint`
  - [ ] `npm run format:check`
  - [ ] `npm test`
  - [ ] `npm run build`
- [ ] Updated JSDoc comments on public APIs, types, and event signatures.
