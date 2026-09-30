# Simulator-first BotC Playable Vertical Slice Route (2026-09-30)

> Project: `Jazz0006/my-game-host-vibration`  
> Status: **NORMATIVE IMPLEMENTATION ROUTE — ACTIVE; SIM-0 COMPLETE, PV-0 NEXT**  
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

SIM-0 has now replaced the early Node/Socket.IO Werewolf `/dev/lab` and retired the static WeChat `preview=1` fake-state path. Those implementations are historical only and must not be revived as parallel authorities.

Simulator Lab V2 is the current daily development surface and is composed around production seams.

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

### SIM-0 — Simulator Lab V2 foundation ✅ COMPLETE

Goal: establish the daily development surface before pushing more BotC behavior into phone UI.

Deliver:

- audited and retired the legacy Node/Socket.IO `dev/lab`, source-string bootstrap patching, standalone recovery lab and old `npm run simulate` path;
- moved the shared `TestRoomClient` and in-memory Cloudflare capability adapter to `dev/` so Simulator Lab and deterministic multiplayer tests consume one implementation;
- established a BotC-focused dev coordinator that creates 5–15 independent clients through production bootstrap / Raw WebSocket / ClientSession / projection seams;
- added a phone-size selected viewer, N simplified virtual-client controls, Human/Automatic Storyteller assignment, semantic-command entry, authoritative projection inspector and bounded trace;
- added deterministic disconnect/reconnect controls over the existing ClientSession generation/revision semantics;
- retired WeChat `preview=1` / `lobby-preview-state` fake data rather than maintaining a second lobby-state model;
- added no new game rules, BotC lifecycle command or canonical-state injection.

Acceptance:

- one developer can create a 5–15 participant BotC room without real devices; the default UI starts from 8 participants;
- viewer can switch among independently synchronized player identities and inspect each identity-bound authoritative room / PlayerView channel;
- Human Storyteller assignment is performed through production `room.setGameModerator`, and authorized moderator projection is therefore obtained through the normal production projection path;
- the lab uses production/runtime projection seams rather than copied game logic or direct Durable Object snapshot access;
- existing multiplayer tests remain authoritative for deterministic correctness, and SIM-0 adds dedicated 8-client / moderator / disconnect-reconnect acceptance;
- secret-differentiated role PlayerViews are intentionally deferred to PV-2, because BotC production start/role-reveal commands do not yet exist; SIM-0 does not add a test-only state injection merely to manufacture that evidence.

### PV-0 — Lobby production interaction closure ✅ COMPLETE

Complete the shared pre-game surface before deeper BotC UI:

- authoritative Ready command/state + first-ready vibration capability hook;
- player reorder production UI over existing `room.movePlayerSeat`;
- moderator assignment production UI over `room.setGameModerator`;
- settings transfer-host / remove-player wiring;
- preserve Owner / Moderator separation.

Implementation result:

- added game-neutral authoritative `RoomPlayer.ready`, persisted in `RoomSnapshot` and normalized into generic / Werewolf / BotC room projections;
- added `room.setReady { ready }` to the existing room-management semantic-command owner; each authenticated player may change only their own Ready value while the game is still in Lobby;
- Ready remains a player attribute, **not** a Room phase and not a new game-start gate;
- WeChat Lobby now renders authoritative Ready state and sends `room.setReady`; the first successful transition into Ready on a page instance performs the existing heavy short-vibration capability check;
- Room Owner long-press drag reorders outer players through `room.movePlayerSeat`; local movement is presentation-only preview until authoritative projection returns;
- dragging an outer player into the center uses `room.setGameModerator(Human)`; dragging the human moderator back to the ring first moves its hidden authoritative seat, then restores `Automatic`;
- Settings now subscribes to authoritative room projection and wires `room.transferHost` / `room.removePlayer`, preserving Owner / Moderator separation and existing Automatic fallback when a human moderator is removed;
- no Ready Check phase, local fake room state, second room-management owner, or BotC-specific lobby rule was added.

Primary validation: Simulator Lab + focused/client tests. Simulator acceptance now proves `room.setReady` fan-out across independent BotC ClientSessions.  
Validation checkpoint: `quality` PASS; 132 test files / 543 tests; Web client and both WeChat product shells build/verify PASS.  
Real-device requirement: none for correctness; later one-device touch/vibration smoke remains an escalation check.

### PV-1 — Minimal BotC Setup + production start path ✅ COMPLETE

Deliver the smallest playable Trouble Brewing start:

- one fixed supported script: Trouble Brewing;
- minimal legal automatic roster generation;
- canonical actual/shown assignment creation;
- BotC production client protocol;
- Cloudflare BotC game-command handler;
- `botc.startGame` or equivalent stable semantic entry;
- no advanced setup recommendation requirement.

Human Storyteller manual controls may be added only where needed for the playable path.

Implementation result:

- fixed production script remains Trouble Brewing;
- added a minimal automatic setup generator that samples the official base category counts, deliberately excludes Baron from this baseline, and delegates final canonical legality to the existing `normalizeTroubleBrewingSetup` owner rather than creating a second setup-rules implementation;
- if Drunk is selected, the baseline chooses a Townsfolk shown role that is not actually in play, preserving the existing actual/shown separation;
- added stable `botc.startGame` client protocol and a Cloudflare BotC game-command handler/runtime;
- start authority reuses `hasGameModeratorControl`: Automatic mode is started by Room Owner, Human mode only by the designated Storyteller;
- Human Storyteller remains a room member but is excluded from role assignment through the existing `gameParticipantPlayers` owner;
- start command reuses `RoomCommandRuntime` commandId idempotency, persisted RoomSnapshot revisioning, production projection, and ClientSession fan-out;
- the BotC WeChat product shell now has `startCommand: "botc.startGame"`; the existing Lobby button therefore reaches the production BotC start path without game-specific page logic;
- no advanced setup recommendation policy, Baron selection policy, manual role editor, or role-reveal UI was added in PV-1.

Simulator acceptance now proves:

- an 8-player BotC room transitions from Lobby to canonical `role_reveal` through the production command handler;
- ordinary clients receive only their own PlayerView and Room Owner does not gain assignment secrets;
- replaying the same `botc.startGame` commandId returns the original outcome without advancing revision;
- in Human Storyteller mode the Owner is denied game start, the designated Storyteller can start, receives ModeratorView, and is excluded from the five-player role assignment.

Validation checkpoint: `quality` PASS; 134 test files / 559 tests; Web client and both WeChat product shells build/verify PASS.

### PV-2 — Role reveal / confirmation vertical slice ✅ COMPLETE

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

Implementation result:

- extended the stable BotC client protocol with per-player `botc.confirmRole`;
- the Cloudflare BotC runtime executes confirmation through the existing `BotcGameModule.handleCommand({ type: "confirmRole" })`, using player-scoped `RoomCommandRuntime` idempotency rather than duplicating role-confirmation rules in transport/runtime code;
- five independent Simulator clients now confirm sequentially, authoritative `confirmedRoles` converges to 5/5, each confirmed PlayerView changes from `role_reveal` to `waiting`, and duplicate command delivery replays without advancing revision;
- a Human Storyteller remains `spectator` and cannot issue player role confirmation;
- added a shared WeChat `pages/game` thin projection page: BotC product configuration supplies `gamePage` and `confirmRoleCommand`, Lobby redirects only after authoritative `gameStarted=true`, and the game page renders only the current PlayerView plus public confirmation progress;
- the page never reads canonical assignments, `actualRoleId`, or `shownRoleId`; Drunk therefore sees the shown Townsfolk already selected by the authoritative PlayerView owner;
- existing projection tests now explicitly prove Drunk actual-vs-shown privacy, cross-player role isolation, and Room Owner remaining on PublicView while Human Storyteller alone receives ModeratorView.

PV-2 stops at **ready-to-proceed after all confirmations**. The actual `beginFirstNight` production command/UI and first-night interaction surface belong to PV-3 so the client is not advanced into an unsupported phase.

Validation checkpoint: `quality` PASS; 134 test files / 561 tests; Web client and both WeChat product shells build/verify PASS.

### PV-3 — First-night playable UI ← IN PROGRESS

Support the minimum first-night loop through production commands and views:

- waiting/asleep;
- wake/attention state;
- private information display;
- player target selection when required;
- acknowledge/complete action;
- progress to next step;
- dawn.

Where recommendation quality is not yet implemented, use the simplest rules-legal baseline sufficient to exercise the flow.

#### PV-3A — Production first-night orchestration ✅ COMPLETE

PV-3A deliberately closes the transport/view orchestration before pretending that every role action is implemented:

- added stable `botc.beginFirstNight` and `botc.completeNightStep` production commands;
- both moderator commands reuse the existing `BotcGameModule` night-sequence owner, `hasGameModeratorControl`, moderator-scoped `RoomCommandRuntime` idempotency, RoomSnapshot revision persistence and authoritative state fan-out;
- added standard 7+ player Minion Info to the existing private PlayerView owner: an actual Minion learns the actual Demon and fellow actual Minions; this does not leak into PublicView;
- reused the already committed Demon Info/bluff baseline and private Demon-only delivery at the canonical `demon_info` step;
- the shared WeChat game page now supports asleep/waiting, wake/attention with one heavy vibration per new wake step, private Minion/Demon info, Storyteller current-step/actor display, controller begin/advance controls and dawn;
- Simulator acceptance runs seven production BotC clients from role confirmation through `minion_info`, `demon_info`, later wake steps and finally Day 1;
- Human Storyteller authority is explicitly enforced for first-night begin/advance; Room Owner cannot issue those commands while a Human Storyteller is assigned.

PV-3A is **not** completion of automatic first-night gameplay. The current night sequence intentionally owns only ordering/actors. Poisoner target/effect, Spy grimoire, Washerwoman/Librarian/Investigator/Chef/Empath/Fortune Teller information resolution, Butler choice, and similar role-specific input/information still need authoritative Rules/Information + command/view owners before Automatic Storyteller may advance those steps without human resolution.

Validation checkpoint: `quality` PASS; 134 test files / 565 tests; Web client and both WeChat product shells build/verify PASS.

#### PV-3B — Role action / information resolution ← NEXT

Close the actual role-interaction contract behind the already-live night cursor:

- classify each first-night role step as no-input private information, player target/choice, or moderator-resolved information;
- add the smallest stable production request/response shapes and private PlayerView payloads required by those categories;
- implement required target selection/acknowledgement without adding client-side rules or direct canonical mutation;
- reuse existing Demon Info, registration, Washerwoman candidate and Recommendation seams where already available;
- add missing rules/information owners only where the playable vertical slice requires them; do not resume broad B0C3B recommendation-depth work merely because a role needs a legal baseline;
- only after every active first-night step has a rules-legal resolution path should PV-3 be marked complete and Automatic Storyteller be allowed to progress through the whole night without manual semantic gaps.

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

Do **not** resume broad B0C3B merely because first-night orchestration is now production-connected.

SIM-0 established the Simulator-first development surface. PV-0 closed the shared production Lobby contract. PV-1 closed the minimal production start path. PV-2 closed private role reveal/confirmation. PV-3A now closes the first-night transport/orchestration shell: moderator-authorized begin/advance commands, asleep/wake PlayerViews, standard Minion/Demon private information, Storyteller step visibility and dawn all run through production ClientSession/Cloudflare/RoomSnapshot seams.

Immediate next task:

> **PV-3B — implement authoritative first-night role action / information resolution.**

PV-3B must fill the semantic gaps inside the already-canonical night cursor rather than create another night engine. Start by classifying active Trouble Brewing first-night roles into target/choice vs private-information vs moderator-resolved steps, then provide rules-legal request/commit/PlayerView contracts for the minimum playable path. Existing information/recommendation owners should be reused; missing rules should be added narrowly. PV-3 remains IN PROGRESS until every role step the automatic path can encounter has a real resolution path.
