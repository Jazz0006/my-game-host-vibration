# Simulator-first BotC Playable Vertical Slice Route (2026-09-30)

> Project: `Jazz0006/my-game-host-vibration`  
> Status: **NORMATIVE IMPLEMENTATION HANDOFF — ACTIVE**  
> Route owner: current execution order is governed by V5; this document owns the detailed Simulator-first / playable-vertical-slice decomposition.  
> Supersedes as NEXT: continuing directly from B0C3A into B0C3B recommendation depth.

---

## 1. Decision

The project is deliberately changing implementation order.

The architecture, game-module foundation, reliability infrastructure and multiplayer harness are substantially more mature than the real playable client path. Continuing deeper into storyteller recommendation before a player can complete a minimal BotC flow on realistic clients would increase this maturity imbalance.

Therefore:

> **Playable vertical integration now has priority over additional recommendation depth.**

B0C3A remains accepted useful domain infrastructure. B0C3B and later recommendation-quality work are deferred until the playable path needs them.

The new product-development principle is:

```text
rules-legal baseline
        >
advanced recommendation quality

playable end-to-end path
        >
additional backend depth

simulator evidence
        >
routine real-device iteration
```

Advanced storyteller recommendation remains a long-term product differentiator, but it is not the current MVP gate.

---

## 2. Current maturity assessment

### Strong / reusable foundation

Already present:

- Cloudflare room authority / Durable Object persistence;
- stable identity / resume / reconnect;
- ClientSession and authoritative revision reconciliation;
- game-specific product shells;
- Room Owner / Game Moderator authority separation;
- BotC Trouble Brewing GameModule;
- actual-vs-shown role model;
- first-night and later-night sequencing foundation;
- Demon Info legal candidates + baseline bluff selection;
- B0C3A registration / truthful Washerwoman candidate foundation;
- TestRoomClient;
- 10-client convergence;
- deterministic reconnect / retry / stale-generation fault testing.

These are retained.

### Product-path gaps that now take priority

The real product still lacks a coherent BotC vertical path:

- BotC WeChat product has no production `startCommand`;
- Cloudflare game-command registry has no BotC command handler;
- no stable BotC client-command protocol is wired through production transport;
- Trouble Brewing setup validates already-chosen assignments but does not yet generate the minimal playable roster;
- no real BotC Setup flow;
- no production role-reveal / confirm-role client flow;
- no production first-night client UI;
- no complete day / nomination / voting / execution loop;
- lobby Ready remains preview-only;
- lobby reorder has backend semantics but no real drag UI;
- moderator assignment has backend semantics but no real lobby interaction;
- settings transfer-host / kick UI remains preview-only.

This is the reason the project can appear "far into recommendation" while still feeling like a shell from the player's perspective.

---

## 3. Simulator-first development policy

Normal feature development defaults to **zero real devices**.

Validation order:

```text
pure / contract tests
        ↓
TestRoomClient multiplayer scenarios
        ↓
Simulator Lab V2
        ↓
WeChat Developer Tools
        ↓
one real-device platform smoke
        ↓
two real devices + N virtual players (only when needed)
        ↓
full-table milestone acceptance
```

The simulator does not replace final platform evidence. It removes real devices from the ordinary correctness and UI-iteration loop.

### Real devices are reserved for evidence that cannot be trusted to desktop simulation

Examples:

- actual vibration strength;
- real foreground/background behavior;
- screen lock / unlock;
- WeChat process restart and stored-session recovery;
- Wi-Fi <-> cellular transition;
- airplane-mode loss/recovery;
- Bluetooth/audio behavior;
- real touch ergonomics;
- long-press / drag feel;
- keyboard / safe-area / small-screen issues;
- share/deep-link behavior inside real WeChat.

Everything else should first be made reproducible without real hardware.

---

## 4. Simulator Lab V2 product

The current `/dev/lab` is an early Node/Socket.IO Werewolf virtual-player tool. The WeChat `preview=1` path is a static local presentation preview. Neither should become the future authority.

Simulator Lab V2 should converge them around the current production seams.

### 4.1 Core topology

```text
authoritative Room / Game Runtime
              │
      production projection
              │
         ClientSession
       ┌──────┴─────────┐
       │                │
Real-client simulator   Simplified virtual clients
       │                │
phone-size viewer       N-player control board
       │                │
       └──── Storyteller / Debug Inspector
```

The lab should use TestRoomClient / the same public runtime seams whenever practical. It must not read or mutate Durable Object internals as a normal gameplay mechanism.

### 4.2 Real-client simulator

Purpose: represent one selected participant almost like a phone client.

Required capabilities:

- portrait/mobile viewport;
- switch viewer between Room Owner / ordinary player / Game Moderator;
- render authoritative room projection;
- render authoritative PlayerView / ModeratorView as applicable;
- send the same semantic commands available to the product client;
- show connection/sync/reconnect state;
- allow UI work without a physical phone.

It may use a development-specific renderer, but **must not calculate game truth locally**.

### 4.3 Simplified multi-client control board

Purpose: control the rest of the table efficiently, not imitate their final UI.

Capabilities should include, when supported by production semantics:

- create/join enough clients to fill a table;
- bulk role confirmation;
- perform a selected player's pending interaction;
- auto-complete uninteresting legal steps;
- disconnect/reconnect selected player;
- drop/retry response where the harness supports it;
- show player identity, current mode, revision and concise action state;
- show bounded trace.

This view is intentionally compact.

### 4.4 Storyteller / debug inspector

Development-only evidence surface:

- canonical phase / day / night;
- current interaction/step identity;
- actual role vs shown role;
- selected PlayerView;
- ModeratorView;
- PublicView;
- revision / generation;
- command trace;
- privacy comparison.

The inspector must remain outside production player semantics.

### 4.5 Hard ownership rules

Simulator Lab V2 must not:

- become a second GameModule;
- calculate night order;
- generate PlayerView independently;
- decide registration truth;
- rank storyteller choices independently;
- directly mutate canonical game state to bypass commands;
- weaken private-view boundaries;
- create test-only production commands merely for convenience.

When a developer needs an impossible shortcut, first ask whether the production semantic seam is actually missing.

---

## 5. Main implementation route

### SIM-0 — Simulator Lab V2 foundation ← NEXT

Goal: establish the daily development surface before pushing more BotC behavior into phone UI.

Deliver:

- audit current `dev/lab`, static WeChat preview and TestRoomClient seams;
- select the smallest shared simulator composition;
- support game-neutral room creation/join and viewer switching;
- show authoritative room projection and selected PlayerView;
- provide N simplified virtual clients;
- preserve bounded trace / revision evidence;
- do not add new game rules.

Acceptance:

- one developer can create a BotC room with multiple simulated participants without real devices;
- viewer can switch among at least two player identities and observe different private projections;
- the lab uses production/runtime projection seams rather than copied game logic;
- existing multiplayer tests remain authoritative for deterministic correctness.

### PV-0 — Lobby production interaction closure

Complete the shared pre-game surface before deeper BotC UI:

- authoritative Ready command/state + first-ready vibration capability hook;
- player reorder production UI over existing `room.movePlayerSeat`;
- moderator assignment production UI over `room.setGameModerator`;
- settings transfer-host / remove-player wiring;
- preserve Owner / Moderator separation.

Primary validation: Simulator Lab + focused/client tests.  
Real-device requirement: none for correctness; later one-device touch/vibration smoke.

### PV-1 — Minimal BotC Setup + production start path

Deliver the smallest playable Trouble Brewing start:

- one fixed supported script: Trouble Brewing;
- minimal legal automatic roster generation;
- canonical actual/shown assignment creation;
- BotC production client protocol;
- Cloudflare BotC game-command handler;
- `botc.startGame` or equivalent stable semantic entry;
- no advanced setup recommendation requirement.

Human Storyteller manual controls may be added only where needed for the playable path.

### PV-2 — Role reveal / confirmation vertical slice

End-to-end:

```text
start game
-> each player receives only own shown role
-> player confirms "I know my role"
-> all confirmations converge
-> moderator/automatic host can proceed
```

Critical privacy acceptance:

- Drunk sees shown Townsfolk, not actual Drunk;
- another player's role never appears in ordinary PlayerView;
- Room Owner gains no storyteller secret merely by ownership.

### PV-3 — First-night playable UI

Support the minimum first-night loop through production commands and views:

- waiting/asleep;
- wake/attention state;
- private information display;
- player target selection when required;
- acknowledge/complete action;
- progress to next step;
- dawn.

Where recommendation quality is not yet implemented, use the simplest rules-legal baseline sufficient to exercise the flow.

### PV-4 — Minimal day / night loop

Add the minimum state/actions required to complete repeated play:

- day state;
- nomination;
- voting;
- execution;
- death state;
- transition to next night;
- minimum Imp / Poisoner / relevant player interactions;
- return to day;
- basic win/end handling when required by the slice.

Do not attempt full Trouble Brewing richness before one coherent loop works.

### PV-5 — Simulator full-game acceptance

Using Simulator Lab V2 + TestRoomClient:

- full table can run the selected minimal game loop;
- different private views remain isolated;
- disconnect/reconnect one participant mid-flow;
- same-command retry remains idempotent;
- viewer switching cannot expose another player's secret through stale UI;
- bounded trace makes failures diagnosable.

This is the first meaningful "playable" engineering milestone.

### PV-6 — WeChat Developer Tools parity

Only after Simulator milestone:

- wire/render the same semantic states in the generated BotC WeChat shell;
- verify WXML/WXSS/navigation;
- verify wx capability adapters;
- keep production game truth server-side.

### PV-7 — Minimal device acceptance

Escalate hardware gradually:

#### D0 — default development
```text
0 real devices
Simulator Lab V2 + automated multiplayer
```

#### D1 — platform smoke
```text
1 real device + N virtual clients
```

Use for vibration, lifecycle, real touch and network behavior.

#### D2 — cross-real-client smoke
```text
2 real devices + N virtual clients
```

Only when behavior specifically depends on two real WeChat instances.

#### D3 — full-table acceptance
6–10 real participants/devices only for milestone UX/operational validation.

---

## 6. Recommendation work after the route correction

### Keep

- B0C1 legal Demon Info boundary;
- B0C2 baseline Demon bluff recommendation;
- B0C3A registration / truthful Washerwoman candidates;
- the long-term Recommendation Engine boundary.

### Defer as mainline

- B0C3B Washerwoman ranking/commit work unless required by a playable information-display step;
- Librarian / Investigator recommendation depth;
- sophisticated poison/drunk misinformation selection policy;
- evidence-driven ranking quality;
- advanced storyteller narrative/world modelling.

When the playable path reaches one of these decisions, prefer:

```text
Rules / Information legal candidates
-> simple deterministic/random baseline
-> Game Engine commit
-> PlayerView delivery
```

Then improve recommendation quality later without redesigning the client path.

---

## 7. Relationship to multiplayer T-route

The T-route is no longer a loosely parallel side project. It becomes part of the playable-development feedback loop.

Already complete:

- T0 seam audit;
- T1 TestRoomClient;
- T2 10-client convergence;
- T3 reconnect / deterministic fault injection.

Next integration:

- T4 privacy/projection matrix should support SIM/PV milestones and stable BotC views;
- T5 becomes a minimal device-smoke toolkit, not a daily two-device requirement;
- full-table testing remains milestone-only.

Simulator Lab V2 may provide a human-facing controller over the same concepts, but deterministic TestRoomClient scenarios remain the automated correctness owner.

---

## 8. UI development relationship

The existing WeChat lobby/table UI baseline remains the UX source for:

- rounded table layout;
- Ready presentation;
- moderator position;
- owner controls;
- game-specific shell identity;
- settings/room management.

The simulator should make it cheap to iterate those states, but must not fork the UX model into an unrelated product.

Final pixel/gesture behavior is still checked in WeChat Developer Tools and selectively on hardware.

---

## 9. Definition of success for the route correction

The correction is successful when:

1. adding a BotC feature normally requires no physical phone;
2. a developer can create/fill a BotC table in seconds;
3. one selected simulated client looks and behaves close enough to the intended mobile interaction to develop the feature;
4. the rest of the table can be controlled compactly;
5. all game truth still comes from production owners;
6. a minimal Trouble Brewing flow reaches role reveal, first night, day, and repeated gameplay through production protocol;
7. physical-device testing becomes an escalation step rather than a normal edit/test loop;
8. storyteller recommendation can improve independently after the playable surface exists.

---

## 10. Immediate handoff

Do **not** start B0C3B next.

Immediate next task:

> **SIM-0 — audit and implement the Simulator Lab V2 foundation over current TestRoomClient / ClientSession / production projection seams.**

First SIM-0 audit should explicitly compare:

- legacy `dev/lab` Node/Socket.IO virtual-player implementation;
- static WeChat `preview=1`;
- `tests/multiplayer/TestRoomClient.ts`;
- `InMemoryCloudflareMultiplayerHarness`;
- production Browser/WeChat ClientSession composition.

The goal is to choose one minimal reusable composition without importing legacy Werewolf-specific semantics into the new lab.
