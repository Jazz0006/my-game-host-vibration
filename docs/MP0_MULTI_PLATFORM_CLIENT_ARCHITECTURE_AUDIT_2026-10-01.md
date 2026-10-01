# MP-0 Multi-platform Client Architecture Audit (2026-10-01)

> Project: `Jazz0006/my-game-host-vibration`  
> Status: **COMPLETE / ACCEPTED**  
> Audited baseline: `main@127547a096cf64d79a4d465493718da089de99d6`  
> Decision: **no mandatory MP-1 code hardening is required before PV-3B2C. Resume PV-3B2C next.**

---

## 1. Audit question

MP-0 asks whether the current Browser/Simulator and WeChat client paths already have a stable ownership boundary, or whether another BotC private-information shape would force new WeChat-specific semantics.

The required boundary is:

```text
Game-specific presentation
        ↓
Shared Client Core
        ↓
Platform capability adapters
        ↓
Browser / Simulator | WeChat | future Android/iOS
```

The audit is deliberately bounded. It does not select a mobile framework, build Android/iOS clients, redesign Cloudflare/GameModule ownership, or introduce speculative platform abstractions.

---

## 2. Result

The current code is already substantially aligned with the target boundary.

The next BotC information shape can flow through:

```text
authoritative BotC private view
  -> shared client projection
  -> BotcGamePresentation
  -> WeChat renderer
  -> Simulator / Browser Reference renderer
```

without choosing a client platform first.

Therefore:

- **MP-0 is COMPLETE.**
- **Mandatory MP-1 before PV-3B2C: NONE.**
- **NEXT: PV-3B2C — Chef + Empath numeric information.**

The clearest remaining cross-platform drift point is duplicated lifecycle recovery policy in Browser and WeChat lifecycle adapters. It is real technical debt, but it does not intersect the numeric-information contract and is not a justified blocker for the playable mainline.

---

## 3. Owner / seam map

| Behavior | Current owner | Classification |
| --- | --- | --- |
| Stable client envelopes, reconnect credentials, command IDs, semantic effect contracts | `src/protocol/client/**` | already shared and correct |
| Connection state, generation fencing, reconnect/resync, authoritative revision reconciliation | `src/client/runtime/ClientSession.ts`, `ClientConnectionFSM.ts`, `AuthoritativeClientStateStore.ts` | already shared and correct |
| Raw WebSocket framing, request correlation, retry and generation handling | `src/client/runtime/RawWebSocketClientTransportCore.ts` | already shared and correct |
| Browser realtime capability | `src/client/browser/CloudflareRealtimeTransport.ts` | platform adapter and intentionally concrete |
| WeChat realtime capability | `src/client/WeChatRealtimeTransport.ts` | platform adapter and intentionally concrete |
| Create/join validation and bootstrap semantics | `src/client/runtime/RoomBootstrapClientCore.ts` | already shared and correct |
| Browser HTTP bootstrap | `src/client/browser/BrowserRoomBootstrapClient.ts` | platform adapter and intentionally concrete |
| WeChat HTTP bootstrap | `src/client/WeChatRoomBootstrapClient.ts` | platform adapter and intentionally concrete |
| Entry presentation | `src/client/ClientEntryPresentation.ts` | already shared and correct |
| Lobby / permission presentation | `src/client/ClientLobbyPresentation.ts` | already shared and correct |
| BotC game presentation | `src/client/BotcGamePresentation.ts` | already shared and correct |
| WeChat WXML/WXSS/page rendering | `miniprogram/pages/**` | product/platform renderer and intentionally concrete |
| Simulator phone renderer and multi-client/debug controls | `dev/labV2.js`, `dev/SimulatorLabCoordinator.ts` | Browser Reference renderer + Lab-only development capability |
| Dev/test public client façade | `dev/TestRoomClient.ts` over Browser bootstrap + production `ClientSession` | Browser/Lab-only development capability |
| Semantic client-effect interpretation | `src/client/effects/ClientEffectDispatcher.ts` | already shared and correct |
| Browser vibration/audio mapping | `src/client/browser/BrowserClientEffects.ts` | platform adapter; best-effort reference behavior only |
| WeChat vibration/audio mapping | `src/client/WeChatClientEffects.ts` | platform adapter and required production capability mapping |
| WeChat persistent reconnect credentials | `src/client/WeChatSessionCredentialStore.ts` | intentionally concrete capability; no second production persistence consumer yet |
| Foreground/background recovery event mapping | Browser and WeChat lifecycle adapters | platform mapping is concrete, but recovery decision switch is duplicated shared semantics |
| Android/iOS locked-screen/background attention | not implemented | deferred future capability |

---

## 4. Important code findings

### 4.1 Transport is already correctly split

`ClientRealtimeTransport` is platform-neutral.

`RawWebSocketClientTransportCore` owns shared wire behavior:

- request correlation;
- command retry;
- generation fencing;
- authoritative state/event frame dispatch;
- sync response parsing.

Browser and WeChat transports own only platform mechanics such as Fetch/WebSocket versus `wx.request` / `SocketTask`, ticket acquisition and native error mapping.

No BotC role or information semantics live in those adapters.

### 4.2 Room bootstrap is already shared

`RoomBootstrapClientCore` owns:

- base URL normalization;
- four-digit room-code validation;
- create/join request semantics;
- bootstrap response validation;
- product `gameType` consistency.

Browser and WeChat bootstrap clients only supply the HTTP capability.

### 4.3 Presentation is already the cross-platform semantic seam

PV-UI0/PV-UI1 already established three shared presentation owners:

- `ClientEntryPresentation`;
- `ClientLobbyPresentation`;
- `BotcGamePresentation`.

The WeChat product UI and Simulator phone UI consume those owners rather than independently deriving application semantics.

This is the most important reason no mandatory MP-1 extraction is needed before Chef/Empath.

### 4.4 Effects are already correctly split

`ClientEffectDispatcher` consumes stable semantic client events.

Platform renderers then map them independently:

- Browser: best-effort vibration/audio;
- WeChat: native short/long vibration and native audio context.

Browser capability is development/reference evidence only and does not satisfy production haptic acceptance.

### 4.5 Credential persistence does not yet justify a shared production port

WeChat has a real persistent credential store backed by native storage.

Simulator/TestRoomClient retains credentials for development recovery scenarios, but this is not a second production persistence adapter. Creating a generic credential-store contract now would be anticipatory rather than required by PV-3B2C.

Revisit when the first installed Android/iOS shell becomes concrete.

---

## 5. Lifecycle recovery drift point

`BrowserSessionLifecycle.ts` and `WeChatSessionLifecycle.ts` both contain the same recovery decision:

```text
Connected    -> resync
Disconnected -> reconnect
all other states -> no-op
```

The platform event sources are correctly different, but the decision switch is shared semantics duplicated in two adapters.

Classification:

> **wrongly duplicated shared semantics, but not a pre-PV-3B2C blocker**

Why it is not included in mandatory MP-1:

- Chef/Empath numeric information does not modify lifecycle behavior;
- both existing lifecycle adapters already have focused tests;
- extracting it now would be an ownership cleanup unrelated to the next playable contract;
- the route explicitly forbids turning MP-1 into a broad refactor.

Track it as bounded later hardening, preferably when a third lifecycle adapter (installed Android/iOS) is introduced or when lifecycle behavior itself changes.

---

## 6. PV-3B2C producer / consumer fan-out

The numeric-information slice should use the existing shared path.

Expected fan-out:

```text
BotC Rules / Information
  -> authoritative committed numeric result
  -> PlayerView / BotC client projection
  -> BotcGamePresentation numeric-information model
  -> WeChat game renderer
  -> Simulator Browser Reference renderer
```

Current relevant producers/consumers and guards:

- BotC authoritative state / private projection:
  - `src/games/botc/**`
  - `src/protocol/client/BotcRoomClientProjection.ts`
- shared derivation:
  - `src/client/BotcGamePresentation.ts`
- platform/product consumers:
  - `miniprogram/pages/game.js`
  - `dev/labV2.js`
- relevant tests:
  - `tests/botcGamePresentation.test.ts`
  - `tests/simulatorClientShellParity.test.ts`
  - `tests/botcClientRoomProjection.test.ts`
  - `tests/cloudflareBotcInformationRuntime.test.ts`
  - existing BotC information-runtime tests.

PV-3B2C must preserve the same privacy rule as pair information: reliability/truth/provenance remain authoritative/moderator evidence and must not leak into the ordinary player's private result.

---

## 7. MP-1 decision

### Mandatory before PV-3B2C

**None.**

The acceptance condition for MP-1 was:

> the next new BotC private-information/action shape can be added without choosing a client platform first.

The current architecture already satisfies that condition.

### Deferred bounded candidates

- extract a shared lifecycle recovery decision helper if lifecycle semantics change or a third platform adapter arrives;
- define a persistent credential-store port when a second production persistence adapter exists;
- add native background/locked-screen attention capabilities only when an installed Android/iOS shell exists.

These are not part of the current playable checkpoint.

---

## 8. Guardrails carried into PV-3B2C

1. Add numeric information to authoritative BotC private state/projection first.
2. Add one shared numeric presentation shape in `BotcGamePresentation`.
3. Keep WeChat and Simulator renderers thin.
4. Do not branch role truth or result derivation inside either renderer.
5. Do not add Browser/PWA production support claims.
6. Do not select Donut, Capacitor, React Native, Flutter or native Kotlin/Swift during this slice.
7. Do not move haptic/audio capability code into game or presentation ownership.

---

## 9. Handoff

```text
PV-UI1 COMPLETE
  ↓
MP-0 COMPLETE
  ↓
MP-1 mandatory pre-PV hardening: NONE
  ↓
PV-3B2C Chef + Empath numeric information ← NEXT
```
