# Technical Hardening

This file tracks deferred hardening work that is intentionally not part of the current delivery slice.

## Open Items

### Connection Leases And Disconnect Handling

Status:

- deferred after Phase 6 auth/session work

Why it remains open:

- player and admin bearer auth are now in place
- hero session tokens are now issued on registration
- request ids and action idempotency keys are now supported
- the server still does not actively reason about stale, disconnected, or abandoned clients beyond normal per-turn behavior

What to pick up later:

- define whether heroes need an explicit heartbeat or lease renewal
- decide what “disconnected” means for gameplay and operator visibility
- add lease expiry or last-seen timestamps to hero/session state if that distinction becomes operationally useful
- expose disconnected or stale-session status in the dashboard only if it improves operator decisions rather than adding noise

Why it is deferred:

- for local-first and small hosted runs, the current auth plus per-turn model is good enough
- adding leases now would increase protocol and state complexity before there is evidence that the extra machinery is needed
