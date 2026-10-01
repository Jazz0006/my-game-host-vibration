# Multi-platform Client Architecture Route (2026-10-01)

> Project: `Jazz0006/my-game-host-vibration`  
> Status: **NORMATIVE INSERTED ROUTE — MP-0 COMPLETE; NO MANDATORY PRE-PV MP-1; PV-3B2C NEXT**  
> Scope: client/runtime architecture for Browser/Simulator as the development reference surface, WeChat Mini Program as a production client, and future Android/iOS production clients.  
> Execution result: MP-0 found the next BotC information shape already has a shared client path. No MP-1 code hardening is required before PV-3B2C; later mobile-framework work remains deferred.

---

## 1. Decision

The project now has two concrete client consumers of production semantics:

1. the WeChat product shells;
2. Simulator Lab V2, whose full-client phone viewer consumes production bootstrap / ClientSession / projection / command seams and already acts as the pre-device application-level acceptance surface.

This is sufficient evidence to formalize the shared client boundary before adding more BotC night interaction shapes.

The project therefore inserts a short multi-platform architecture checkpoint before `PV-3B2C Chef + Empath numeric information`:

```text
PV-UI1 COMPLETE
    ↓
MP-0 Multi-platform Client Architecture Audit      ✅ COMPLETE
    ↓
MP-1 mandatory pre-PV hardening                    NONE REQUIRED
    ↓
PV-3B2C Chef + Empath numeric information          ← NEXT
    ↓
continue PV-3B / playable BotC mainline
```

This is **not** a mobile-app implementation detour. Android/iOS shells, Donut, Capacitor, React Native, Flutter or native Kotlin/Swift are not prerequisites for resuming night logic.

---

## 2. Product/client model

Game product and client platform are independent dimensions.

```text
Game product
  ├─ BotC
  ├─ Werewolf
  └─ future games

Development/reference surface
  └─ Browser / Simulator Lab

Production player platforms
  ├─ WeChat Mini Program
  ├─ Android
  └─ iOS
```

Game-specific product presentation may remain concrete, while protocol/session/reconnect/presentation derivation and platform capability boundaries are shared where there is proven reuse.

The long-term target is:

```text
Game-specific Presentation
        ↓
Shared Client Core
        ↓
Platform Capability Ports
        ↓
Browser-reference / WeChat / Android / iOS adapters
```

Do not create a cross-platform UI framework merely for symmetry. UI remains platform/product specific unless real reuse proves valuable.

---

## 3. Simulator Lab is the Browser Reference Client

Simulator Lab V2 is not a separate rules implementation and must not become one.

Its full-client phone viewer is the **Browser Reference Client** for application semantics:

- entry / create / join / continue;
- Lobby state and permissions;
- production PlayerView / ModeratorView / PublicView consumption;
- semantic commands and idempotent command flow;
- reconnect / resync / stored-session recovery;
- shared presentation derivation;
- client effect intent visibility where useful.

The Lab may retain development-only multi-client controls and debug inspection, but these must remain outside production player semantics.

The Browser Reference Client is the first place shared client behavior should be proven before platform-specific acceptance. It is **not a supported final player product target**: reliable private haptic/vibration alerting is a core product requirement, while browser vibration support is not cross-platform dependable (notably on iOS/Safari). Browser effect handling may therefore simulate/log or best-effort render semantic effects for development evidence without satisfying production haptic acceptance.

---

## 4. Shared Client Core and Platform Ports

### 4.1 Shared Client Core owns

Where already present or justified by current second-client reuse:

- stable client protocol;
- `ClientSession`;
- command / commandId / retry semantics;
- authoritative revision reconciliation;
- reconnect / resync semantics;
- room bootstrap semantics;
- presentation/view-model derivation;
- game-specific presentation contracts such as `BotcGamePresentation`;
- semantic client-effect intents;
- platform-neutral lifecycle recovery policy where one exists.

It must not depend on:

- global `wx`;
- browser DOM;
- Android SDK;
- iOS SDK;
- a future cross-platform framework runtime.

### 4.2 Platform capability ports

MP-0 must audit and, only when currently needed, define stable seams for:

- HTTP / realtime transport;
- credential/local storage;
- app foreground/background lifecycle;
- vibration/haptics (**required production capability for player clients; Browser/Simulator may only simulate or best-effort render it**);
- semantic audio;
- share/invite/deep link when product work reaches them;
- background/locked-screen attention delivery for future installed Android/iOS clients is a real product requirement because app switching/screen lock are normal lifecycle events; MP-0 records the capability boundary, while push/local-notification implementation remains deferred until a mobile production shell exists.

Platform adapters own capability mapping and platform failure handling. Game rules and authoritative state must never call platform APIs directly.

---

## 5. MP-0 — Multi-platform Client Architecture Audit ✅ COMPLETE

### Goal

Map current Browser/Simulator and WeChat client paths to authoritative owners and identify the minimum changes required so future BotC client work does not become WeChat-specific.

### Audit inputs

At minimum inspect:

- `src/protocol/client/**`;
- `src/client/runtime/**`;
- `src/client/effects/**`;
- `src/client/browser/**`;
- `src/client/WeChatRealtimeTransport.ts`;
- `src/client/WeChatRoomBootstrapClient.ts`;
- `src/client/WeChatSessionCredentialStore.ts`;
- `src/client/WeChatSessionLifecycle.ts`;
- `src/client/WeChatClientEffects.ts`;
- `src/client/WeChatNativeClient.ts`;
- shared presentation owners;
- Simulator Lab full-client composition and TestRoomClient boundary.

### Required output

Produce an owner/seam map that classifies each current behavior as one of:

- already shared and correct;
- platform adapter and intentionally concrete;
- wrongly WeChat-specific but semantically shared;
- Browser/Lab-only development capability;
- deferred future capability.

Also identify all producers/consumers affected by any proposed shared contract change.

### Acceptance

MP-0 is complete when:

- Browser/Simulator and WeChat client ownership is explicit;
- Simulator Lab full-client phone viewer is documented as Browser Reference Client;
- no game truth or platform-specific API is allowed to leak across the new boundary;
- MP-1 work is reduced to a bounded list of changes necessary before further PV-3B client expansion;
- no mobile framework is selected merely on expectation.

Accepted audit result is recorded in `docs/MP0_MULTI_PLATFORM_CLIENT_ARCHITECTURE_AUDIT_2026-10-01.md`.

The audit found protocol/session/retry/revision/bootstrap/effect intent and Entry/Lobby/BotC presentation already shared. Browser and WeChat lifecycle adapters duplicate one recovery decision switch (`Connected -> resync`, `Disconnected -> reconnect`), but that drift point does not intersect Chef/Empath numeric information and is therefore deferred rather than promoted into a blocking refactor.

---

## 6. MP-1 — Necessary Shared Client / Platform Port hardening

MP-1 implements only the seams that MP-0 proves are needed **before PV-3B2C**. MP-0 found **no mandatory pre-PV-3B2C MP-1 implementation**.

Typical candidates may include:

- shared credential-store interface with Browser and WeChat adapters;
- shared lifecycle recovery contract with Browser/WeChat mappings;
- shared semantic effect dispatcher plus platform haptic/audio adapters;
- removal of duplicated presentation derivation;
- composition boundaries that let Simulator and WeChat consume the same client semantics.

Do not:

- build Android/iOS clients;
- add speculative push-notification abstractions;
- create a generic cross-platform widget library;
- replace functioning platform adapters only to normalize names;
- redesign Cloudflare or GameModule ownership.

MP-1's acceptance condition is already satisfied by the current code: the next new BotC private-information/action shape can be added through the authoritative projection -> shared `BotcGamePresentation` -> thin WeChat/Simulator renderers without choosing a client platform first. Lifecycle-policy extraction and credential-store generalization remain bounded later candidates, not current blockers.

---

## 7. Resume point

After MP-0 acceptance, with no mandatory MP-1 changes identified:

```text
resume PV-3B2C
  -> Chef + Empath numeric information
  -> later Fortune Teller / Spy / other distinct interaction shapes
```

Those subsequent playable slices become continuing evidence for the shared client architecture.

---

## 8. Android/iOS technology decision

No mobile framework is selected in MP-0/MP-1.

Current candidates:

- WeChat Mini Program multi-platform / Donut;
- Capacitor native Android/iOS shell using Web technologies plus native capability plugins;
- React Native;
- Flutter;
- native Kotlin + Swift if later justified.

The architecture must allow any candidate to implement the platform ports without changing protocol, game semantics or authoritative state. Capacitor must be judged as an installed native app runtime with native haptic/lifecycle/plugin capabilities, not as proof that a plain browser/PWA can satisfy the production-player contract.

### Donut policy

Donut is a **candidate, not an architectural dependency**.

A later bounded viability spike should use an already representative playable BotC flow and test:

- build/install on Android and iOS;
- HTTP + Raw WebSocket behavior against Cloudflare;
- foreground/background reconnect and authoritative resync;
- local session credential persistence;
- strong vibration/haptic behavior;
- semantic audio;
- debugging quality and release-build ergonomics;
- amount of Donut-specific conditional/platform code required.

Accept Donut only if special handling remains concentrated in platform adapter/shell code and normal debugging/release workflow is reliable.

If Donut introduces broad API incompatibility, opaque lifecycle/network failures, or substantial conditional code in shared client logic, stop the spike and retain the shared architecture for another mobile shell.

### Timing

The Donut/mobile viability spike does **not** block PV-3B2C.

Run it only after the playable client has enough representative behavior that the result is meaningful.

---

## 9. Cross-platform conformance direction

Long term, each supported production player platform (WeChat, Android, iOS) should be able to prove the same application-level contract:

```text
create / join / continue
-> authoritative sync
-> private PlayerView
-> semantic command
-> same-commandId retry
-> presentation update
-> disconnect / reconnect
-> authoritative resync
-> semantic client effect
```

Simulator Lab / Browser Reference Client owns the first application-level proof, but does not itself satisfy final player-platform acceptance.

Platform tools and real devices prove what the browser cannot faithfully establish, such as:

- true haptic strength;
- actual OS/app lifecycle;
- process kill / screen lock;
- real network transitions;
- audio/Bluetooth behavior;
- native safe-area/touch behavior;
- platform share/deep-link/notification integration.

---

## 10. Guardrails

- Do not pause the BotC playable mainline for speculative Android/iOS implementation.
- Do not let Simulator Lab become a second GameModule or canonical-state owner.
- Do not encode client platform branches into GameModule or game rules.
- Do not make Donut, Capacitor, React Native or another framework part of the shared domain contract.
- Do not restore Browser/PWA as a production player target unless the mandatory private haptic requirement becomes reliably cross-platform and is explicitly revalidated.
- Prefer existing shared owners over parallel abstractions.
- A new abstraction requires a current concrete second consumer or an already-accepted invariant.
- Resume PV-3B2C immediately after MP-0 + necessary MP-1 are accepted.
