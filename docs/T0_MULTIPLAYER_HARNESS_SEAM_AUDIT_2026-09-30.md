# T0 Multiplayer Harness Contract / Seam Audit — 2026-09-30

> Project: `Jazz0006/my-game-host-vibration`  
> Route: parallel multiplayer test infrastructure  
> Result: **T0 COMPLETE — no production contract blocker**  
> Next: T1 `TestRoomClient` foundation

## 1. Decision

The narrowest useful seam is to compose the existing production client/runtime owners rather than build a second protocol client:

```text
BrowserRoomBootstrapClient
  -> RoomBootstrapClientCore
  -> public Cloudflare room bootstrap HTTP

ClientSession
  -> CloudflareRealtimeTransport
  -> RawWebSocketClientTransportCore
  -> stable Raw WebSocket protocol
  -> GameRoomDurableObject / shared runtime
```

T1 therefore stays **test-only/additive-only**. No production semantic change and no new dependency are required.

The test harness may fake platform/network capabilities, but it must not fake:

- room/game rules;
- PlayerView or room projection generation;
- revision advancement;
- command idempotency;
- reconnect/generation policy;
- Raw WebSocket request/response semantics.

## 2. Owner map

| Concern | Current authoritative owner | T1 reuse |
| --- | --- | --- |
| create/join semantics | `src/client/runtime/RoomBootstrapClientCore.ts` | direct |
| browser HTTP bootstrap adapter | `src/client/browser/BrowserRoomBootstrapClient.ts` | direct |
| stable reconnect credentials | `ClientReconnectCredentials` in client protocol | direct |
| client generation / sync / state reconciliation | `src/client/runtime/ClientSession.ts` | direct |
| transport port | `src/client/runtime/ClientRealtimeTransport.ts` | direct |
| ticket exchange + browser WS capability | `src/client/browser/CloudflareRealtimeTransport.ts` | direct |
| request correlation / retry / generation fencing | `src/client/runtime/RawWebSocketClientTransportCore.ts` | direct |
| Raw WS wire envelope | `src/protocol/client/ClientRawWebSocketProtocol.ts` | direct |
| public Worker room routing | `src/runtime/cloudflare/worker.ts` | direct |
| authoritative room runtime | `src/runtime/cloudflare/GameRoomDurableObject.ts` | direct |
| hibernation player/socket identity | `src/runtime/cloudflare/CloudflareRoomRealtime.ts` | direct |
| player / room projections | existing runtime projection owners | observe only |
| game rules | concrete `GameModule` owners | never duplicated |

## 3. Recommended test directory

```text
tests/multiplayer/
  TestRoomClient.ts
  InMemoryCloudflareMultiplayerHarness.ts
  testRoomClientFoundation.test.ts

  scenarios/        # T2+
  games/            # only thin semantic-command helpers when truly needed
  trace/            # only if bounded trace support grows beyond TestRoomClient
```

T1 should not create a general test framework package or production helper merely for directory symmetry.

## 4. Existing coverage map

| Planned scenario / contract | Existing evidence before T1 | T1 action |
| --- | --- | --- |
| room create/join bootstrap | `cloudflareRoomBootstrap.test.ts` plus bootstrap-client tests | compose into one multi-client path |
| ticket before socket open | `cloudflareRealtimeTransport.test.ts` | reuse production transport |
| Raw WS sync framing | `cloudflareRawWebSocketClientProtocol.test.ts` | reuse production wire/runtime |
| PlayerView + room projection sync | `cloudflareWebClientSessionIntegration.test.ts`, `clientSessionRoomProjection.test.ts` | expose through TestRoomClient |
| revision / stale delivery handling | ClientSession/state-store tests | expose wait/trace surface; deeper faults belong T3 |
| same-commandId retry/replay | Raw WS / WeChat retry tests and server command replay tests | T3 owns fault injection |
| reconnect / generation fencing | ClientSession and WeChat integration tests | T1 only proves persisted-credential resume; T3 owns injected failures |
| Hibernation socket identity | `cloudflareHibernationWebSocket.test.ts` | reuse `CloudflareRoomRealtime` |
| Werewolf game commands | existing Werewolf protocol/runtime tests | no rule helper in T1 |
| BotC shared lobby/runtime admission | existing BotC Raw WS/runtime coverage | run same T1 harness with `gameType=botc` |

T1 is therefore an **integration composition gap**, not a missing production behavior gap.

## 5. Test-side network seam

Vitest cannot rely on a deployed Worker for the fast deterministic L2 suite. The recommended adapter is test-only:

```text
BrowserRoomBootstrapClient
  -> fake fetch capability
  -> real cloudflareWorker.fetch
  -> real GameRoomDurableObject

CloudflareRealtimeTransport
  -> same fake fetch capability for websocket-ticket
  -> test BrowserWebSocket primitive
  -> CloudflareRoomRealtime.acceptPlayerSocket
  -> real GameRoomDurableObject.webSocketMessage
```

The adapter may replace browser/network primitives only.

The actual Cloudflare HTTP 101/WebSocketPair upgrade remains covered by focused runtime tests and later deployed L3 evidence. T1 does not need to add a production WebSocket test hook merely to make Vitest convenient.

## 6. Production-gap list

**NONE for T1.**

No production contract needs widening, no debug-only public endpoint is needed, and no runtime snapshot accessor should be added.

If a later T2/T3 scenario proves impossible through the current public/runtime surface, that gap must be reviewed separately rather than silently adding a test backdoor.

## 7. T1 implementation contract

`TestRoomClient` may:

- create a room;
- join a room;
- retain/resume existing reconnect credentials;
- connect and synchronize via `ClientSession`;
- read its own PlayerView and room projection;
- send stable semantic command envelopes;
- wait deterministically for a target revision;
- capture a bounded, secret-safe trace;
- disconnect and rebuild the client transport/session.

It must not:

- read Durable Object snapshots directly;
- calculate a PlayerView;
- advance revision itself;
- know Werewolf/BotC role rules;
- invent alternate reconnect or retry semantics;
- log resume tokens.

## 8. T1 acceptance

T1 is accepted when:

1. host + at least two players use the same authoritative room;
2. create/join/ticket/Raw WS/ClientSession sync all use production owners;
3. room projection viewer identity is correct per client;
4. a stable room semantic command fans out a new revision;
5. persisted credentials can rebuild the client and resume the same player without duplicate membership;
6. the same harness runs a BotC lobby and a Werewolf lobby;
7. bounded trace evidence is available on failure;
8. `npm run typecheck`, focused multiplayer tests and full `npm test` are green.
