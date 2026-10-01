# Simulator-first BotC Playable Vertical Slice Route (2026-09-30)

> Project: `Jazz0006/my-game-host-vibration`  
> Status: **NORMATIVE IMPLEMENTATION ROUTE — ACTIVE; PV-3B4 SPY GRIMOIRE COMPLETE; PV-4 MINIMAL DAY/NIGHT LOOP NEXT**  
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

Purpose: represent one selected participant as the **reference mirror of the production WeChat client**, not as a simplified development UI.

Required capabilities:

- portrait/mobile viewport;
- switch viewer between Room Owner / ordinary player / Game Moderator;
- render authoritative room projection;
- render authoritative PlayerView / ModeratorView as applicable;
- send the same semantic commands available to the product client;
- show connection/sync/reconnect state;
- allow UI work without a physical phone;
- keep the selected-phone surface in 1:1 product parity with the current WeChat thin client for page structure, visible text, control visibility, navigation flow, layout geometry and interaction intent;
- reuse shared presentation/layout authorities where possible so the Lab cannot silently fork the WeChat UI contract.

The browser is allowed to provide a platform adapter for capabilities that do not exist on desktop (for example, recording that a heavy vibration would have fired), but it **must not replace the product UI with developer shortcuts or alternate controls**. Development-only bulk controls and shortcuts belong only in the separate N-client control board / Inspector. The selected-phone mirror must never calculate game truth locally.

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

#### PV-3B — Role action / information resolution ← IN PROGRESS

Close the actual role-interaction contract behind the already-live night cursor:

- classify each first-night role step as no-input private information, player target/choice, or moderator-resolved information;
- add the smallest stable production request/response shapes and private PlayerView payloads required by those categories;
- implement required target selection/acknowledgement without adding client-side rules or direct canonical mutation;
- reuse existing Demon Info, registration, Washerwoman candidate and Recommendation seams where already available;
- add missing rules/information owners only where the playable vertical slice requires them; do not resume broad B0C3B recommendation-depth work merely because a role needs a legal baseline;
- only after every active first-night step has a rules-legal resolution path should PV-3 be marked complete and Automatic Storyteller be allowed to progress through the whole night without manual semantic gaps.

##### PV-3B1 — Single-target player-choice foundation ✅ COMPLETE

- added a game-owned `TroubleBrewingNightInteraction` contract for active-step target legality instead of letting the client infer role rules;
- added player-scoped `botc.submitNightChoice { playerIds }` with Cloudflare/ClientSession idempotency;
- Poisoner may choose one participant and commits canonical `poisonedPlayerId`; that effect remains private/canonical through the following day and is cleared at the next dusk before a new nightly choice;
- Butler must choose exactly one other participant and commits canonical `butlerMasterPlayerId`; the previous master is cleared at the next dusk;
- moderator generic `completeNightStep` is now rejected for an active step that requires player input, so Human/Automatic control cannot silently skip a mandatory Poisoner/Butler choice;
- choice submission automatically advances the same canonical night cursor after a legal commit;
- only actual-role sourced choices mutate Poisoner/Butler effect state; presentation/transition-derived identity cannot create those canonical effects;
- PlayerView exposes only a generic choice schema (`minTargets`, `maxTargets`, `allowedPlayerIds`) and the WeChat game page renders a role-agnostic target selector; the page contains no Poisoner/Butler role branching;
- ModeratorView may inspect committed night effects, while PublicView and ordinary room projections do not expose the poisoned target or Butler master;
- Cloudflare runtime acceptance proves wrong-actor rejection, persisted revision, commandId replay and public secrecy.

Validation checkpoint: `quality` PASS; 136 test files / 569 tests; Web client and both WeChat product shells build/verify PASS.

##### UGSM-0 / UGSM-1 — Canonical snapshot compatibility gate

Before PV-3B2 adds durable information-result semantics, the online runtime must align with the cross-project `TroubleBrewingGameSnapshotV1` contract.

UGSM-0 is complete in `docs/UGSM0_UNIFIED_TROUBLE_BREWING_GAME_SNAPSHOT_ADOPTION_AUDIT_2026-09-30.md` and freezes these boundaries:

- mutable online `BotcGameState` remains the authoritative GameModule state;
- `TroubleBrewingGameSnapshotV1` is a pure deterministic read-only projection, not a replacement runtime state;
- canonical unresolved facts use explicit KNOWN / UNCOMMITTED / UNKNOWN / NOT_APPLICABLE semantics;
- Room Runtime / transport / session / client capability state is excluded;
- current immediate Drunk commitment is a runtime behavior and must not become a snapshot-schema assumption.

UGSM-1 is complete: `src/games/botc/TroubleBrewingGameSnapshot.ts` independently owns the frozen V1 contract/codec, while `TroubleBrewingGameSnapshotProjection.ts` provides the pure `BotcGameState + explicit projection context -> TroubleBrewingGameSnapshotV1` runtime adapter; JSON field order remains Host-compatible. The projector does not invent `gameSeed` or missing revision semantics; those values remain explicit caller context / NOT_APPLICABLE until this runtime has authoritative producers. Validation: typecheck PASS; full test PASS, 137 files / 574 tests; Web and both WeChat product shells build/verify PASS.

##### PV-3B2 — First-night information resolution ✅ COMPLETE

With UGSM-1 accepted, implement the information-bearing Townsfolk path before Fortune Teller/Spy specialization.

###### PV-3B2A — Washerwoman information runtime ✅ COMPLETE

The first reusable pair-information vertical slice now establishes the production contract:

- Rules / Information owns the legal Washerwoman candidate domain and stable candidate IDs;
- Recommendation owns a versioned deterministic baseline selection (`baseline_v1`) without narrative-quality scoring;
- GameModule owns authoritative commit / acknowledgement / night-cursor advancement only;
- canonical runtime history persists the selected pair result, reliability (`reliable` / `drunk` / `poisoned`), semantic truth and exact registration resolution so reconnect/replay never recomputes the delivered result;
- player private projection exposes only what the player is allowed to see: learned role + two shown players; reliability, semantic truth and registration proof remain moderator/history-only so Drunk/Poisoned status is never leaked;
- information steps cannot be skipped with generic moderator `completeNightStep`: an authoritative result must be committed first and the active recipient must acknowledge it before the night cursor advances;
- Automatic Storyteller commits the baseline information in the same authoritative Cloudflare mutation that enters the information step; Human Storyteller retains explicit commit authority and the Room Owner cannot substitute for the designated Storyteller;
- protocol/runtime adds semantic `botc.commitNightInformation` and `botc.acknowledgeNightInformation` commands with the existing commandId idempotency path;
- shared WeChat game UI renders generic pair information and acknowledgement controls without a Washerwoman-specific page branch;
- Simulator first-night orchestration now drives private-information acknowledgement before player-target choice / generic moderator advance.

Cross-project compatibility note: CampBoardGameHost live `main` (`4593f79186d0af388e2d1c25e272462c576f5548` when audited) still keeps `TroubleBrewingGameSnapshotV1` deliberately narrow. PV-3B2A therefore does **not** independently alter the V1 wire schema. Runtime information history is aligned with the Host's reliability / semantic-truth / registration semantics; a future delivered-information snapshot extension remains coordinated cross-project work rather than a Web-Host-only schema fork.

Validation checkpoint: `quality` PASS; 139 test files / 580 tests; Web client and both WeChat product shells build/verify PASS. Cloudflare acceptance covers automatic same-revision commit, private/public secrecy, Human Storyteller authority and idempotent acknowledgement replay.

###### PV-3B2B — Librarian + Investigator pair information ✅ COMPLETE

PV-3B2A's lifecycle is now a shared pair-information family rather than three role-specific runtime paths:

- Rules / Information owns one candidate generator for Washerwoman / Librarian / Investigator, parameterized by target category while preserving exact Spy / Recluse registration provenance;
- the information recipient remains a legal member of the shown pair. This covers valid Baron setups where Washerwoman is the only Townsfolk and must be able to learn themself plus one other player;
- Librarian zero is a typed `no_characters / outsider` result and is truthful only when there are actually zero Outsiders in play; a Spy registering as an Outsider may coexist with the truthful zero candidate because registration does not create an actual Outsider;
- a Drunk shown Librarian is still an actual Outsider, so a zero result is not placed in the natural truthful candidate domain merely because the Drunk is the recipient;
- Recommendation uses one deterministic `pair_information / baseline_v1` request/selection path with no narrative scoring;
- GameModule uses one authoritative commit / acknowledgement / skip-guard path for all three roles; reliability, semantic truth and exact resolution provenance remain durable moderator/history facts;
- PlayerView exposes only the recipient-visible pair or typed zero result, never reliability / semantic truth / registration proof;
- Automatic Storyteller still commits when the authoritative Cloudflare mutation enters the information step; Human Storyteller keeps explicit commit authority and commit does not advance until recipient acknowledgement;
- shared WeChat UI renders both pair information and generic `no_characters` information without Librarian / Investigator role branches;
- Simulator's production first-night loop continues to consume the generic private-information + acknowledgement contract unchanged.

Cross-project follow-up: the live CampBoardGameHost natural pair generator currently excludes the information source seat, while the official Washerwoman run procedure permits the Washerwoman themself to be the matching Townsfolk when necessary. This Web Host implementation follows the rules-correct domain and records the discrepancy for later Host alignment; it does **not** change the frozen `TroubleBrewingGameSnapshotV1` wire schema.

Validation checkpoint: typecheck PASS; full test PASS, 141 test files / 587 tests; Web client and both WeChat product shells build/verify PASS. Cloudflare acceptance covers Librarian zero automatic same-mutation commit / secrecy plus Investigator Human Storyteller authority.

##### PV-UI0 — Simulator / WeChat presentation convergence ✅ COMPLETE

This bounded UI-infrastructure checkpoint is inserted before further role UI expansion so daily Simulator work does not drift from the product client:

- added shared pure `BotcGamePresentation` under `src/client` as the single derivation owner for phase labels, role display, wake/wait state, target-choice display, private information labels, progress, status copy and semantic action availability;
- the WeChat `pages/game` thin page now consumes that shared presentation model instead of independently deriving those semantics;
- the Simulator Lab phone-size viewer imports the same browser-built presentation module and renders a WeChat-style game page mirror for role reveal, Storyteller view, wake/wait, night choices, Minion/Demon info, pair/zero private info, progress and action buttons;
- actions performed from the mirrored phone surface still travel through `/dev/simulator/api/command -> TestRoomClient -> production ClientSession / runtime seams`; the mirror does not mutate canonical state or calculate BotC truth;
- Simulator remains local-first over `InMemoryCloudflareMultiplayerHarness`. It deliberately does **not** require the deployed Cloudflare Worker for daily development; real Cloudflare + WeChat Developer Tools remains a later integration acceptance layer;
- visual CSS is a browser mirror of the current WeChat game page, while WXML/WXSS remain the actual product renderer. Future game-display semantics should first enter the shared presentation model so both surfaces converge by construction.

Acceptance:

- both WeChat and Simulator consume `createBotcGamePresentation`;
- role-specific UI logic remains outside the thin renderers where the generic presentation contract can express it;
- Simulator phone controls can issue current production BotC commands for confirm-role, begin-night, target choice, information acknowledgement/commit and generic night-step advance;
- automated presentation tests cover role reveal, pair/zero information, target selection and Human Storyteller action availability;
- full test/build validation remains green.

##### PV-UI1 — pre-device full client-shell parity ✅ COMPLETE

The Simulator Lab acceptance role is now explicit: before WeChat Developer Tools / hardware escalation, **all application-level client semantics and end-to-end flows should be exercised in the Lab first**.

Implementation:

- added shared `ClientEntryPresentation` for four-digit room-code normalization / join availability and shared `ClientLobbyPresentation` for owner, readiness, Storyteller, participant ordering and action-availability semantics;
- WeChat Entry, Lobby and Settings now consume those shared owners instead of maintaining independent derivation logic;
- the Lab has a **Full Client mode** that creates 1–15 virtual devices with no room/session yet. A selected virtual phone can create a room, enter a four-digit room code to join, move through authoritative Lobby, ready/unready, manage seats/Storyteller, open room management, transfer ownership/remove players, start BotC and then continue into the existing game mirror;
- the full-client path uses production bootstrap + `TestRoomClient / ClientSession`; it does not invent a browser-only room or mutate canonical state directly;
- a virtual device can simulate network disconnect/reconnect independently, or simulate closing WeChat by disposing its active session while retaining credentials; its Entry mirror then exposes **继续上次房间** and restores through the stored credential path;
- the existing **Quick Table mode** remains intentionally available and still requires 5–15 BotC players, so rules/role development can jump directly to a populated room without paying full entry-flow cost on every test;
- parity guard tests require Entry/recovery, Lobby, room-management and game surfaces to retain the expected shared presentation / production-command seams.

Pre-device acceptance boundary:

```text
Application semantics / permissions / multiplayer convergence
Entry -> Create / Join / Continue
Lobby -> Ready / seats / Storyteller / room management
Start game -> private PlayerView -> game interactions
disconnect / reconnect / session close / stored-session restore
                    = Simulator Lab owner

actual WXML/WXSS + WeChat navigation/touch runtime
wx.vibrateShort and other wx capability behavior
foreground/background lifecycle on WeChat runtime
real phone safe-area/font/layout quirks
deployed Cloudflare Worker + public WebSocket/network behavior
                    = WeChat Developer Tools / staged device acceptance
```

This makes “Lab replaces real-device testing before the platform acceptance stage” an explicit architecture contract rather than merely a developer convenience. Automated validation at implementation checkpoint: 145 test files / 599 tests PASS before the final quality-gate rerun.

The browser-hosted Lab is a **development/reference client surface, not a final production player target**. Private vibration/haptic alerting is a mandatory player capability, while plain browser support is not reliably cross-platform (especially iOS/Safari). Browser effect rendering may be simulated or best-effort; final haptic evidence belongs to WeChat / Android / iOS platform acceptance.

MP-0 is complete. The accepted audit in `docs/MP0_MULTI_PLATFORM_CLIENT_ARCHITECTURE_AUDIT_2026-10-01.md` found no mandatory MP-1 code hardening before another information shape: protocol/session/bootstrap/effect intent and shared Entry/Lobby/BotC presentation seams are already cross-client. Browser/WeChat lifecycle recovery-policy duplication remains a bounded later hardening candidate and does not block this slice.

###### PV-3B2C — Chef + Empath numeric information ✅ COMPLETE

Chef and Empath now reuse the same authoritative information lifecycle while keeping a distinct numeric result family:

- `BotcGameState` persists explicit `seatingPlayerIds` from the authoritative participant order so circular rules never infer seats from setup-assignment array order;
- Rules / Information owns alignment registration provenance: normal actual alignment, Spy may register good, and Recluse may register evil;
- Chef generates the complete truthful numeric domain from circular adjacent evil-player pairs, including wraparound and independent Spy/Recluse registration choices for separate pair checks;
- Empath resolves the two closest **distinct alive** neighbours clockwise/counterclockwise, skipping dead players, and works on both first night and later nights;
- numeric candidates/results carry stable candidate IDs, exact registration-resolution provenance, reliability and semantic truth in authoritative history;
- `baseline_v1` deterministically chooses within the truthful legal domain; Drunk/Poisoned reliability remains separate and may still accompany a truthful result;
- Washerwoman/Librarian/Investigator/Chef/Empath now share one commit -> private delivery -> recipient acknowledgement -> advance gate, so generic moderator step completion cannot bypass any of them;
- ordinary PlayerView exposes only `{ kind: "number", abilityRoleId, value }`; reliability/truth/provenance remain moderator/history-only;
- Cloudflare Automatic Storyteller auto-commits Chef/Empath through the existing generic information mutation path with no new protocol command;
- shared `BotcGamePresentation` owns numeric display, including an explicit zero-safe presence flag, and both WeChat and Simulator render the same presentation without role-truth branches;
- `TroubleBrewingGameSnapshotV1` remains unchanged.

Validation checkpoint: typecheck PASS; full test PASS, 147 test files / 606 tests; Web client and both WeChat product shells build/verify PASS.

###### PV-3B3 — Fortune Teller dual-target + Red Herring/result semantics ✅ COMPLETE

Fortune Teller now composes the existing player-choice and committed-information seams instead of introducing a role-specific transport path:

- Rules / Information owns the Red Herring legal domain: only **actual-good** players are legal candidates; Spy is therefore excluded even though it may register good, while Recluse remains eligible because its actual alignment is good;
- Automatic Storyteller Red Herring choice is routed through a Recommendation request / `baseline_v1` policy, keeping legal-candidate generation separate from decision quality;
- Human Storyteller mode exposes `botc.setRedHerring` before first night, restricted to the designated human Storyteller; ordinary players never receive the Red Herring fact;
- the same Red Herring persists for the game and is committed before Fortune Teller information is resolved;
- Fortune Teller's existing generic target selector now accepts exactly two **distinct** participant targets, including self or dead players; target submission records an authoritative per-night choice but does **not** advance the night cursor;
- after target submission, the normal information gate becomes ready: Human Storyteller may explicitly commit, while Automatic Storyteller reuses the existing same-mutation auto-commit hook;
- YES is rules-legal when either selected target is the Red Herring or can register as a Demon; actual Imp therefore forces YES, while Recluse registration may create both YES and NO legal candidates;
- authoritative history retains selected targets, registration / Red-Herring resolution provenance, reliability and semantic truth; ordinary PlayerView receives only `{ kind: "boolean", abilityRoleId: "fortune_teller", value }`;
- the shared `BotcGamePresentation` renders `是 / 否` explicitly so `false` is not lost to truthy/falsy UI handling; WeChat and Simulator consume the same presentation owner;
- reconnect/idempotency remains on the existing `ClientSession` / command-ledger / RoomSnapshot seams, and `TroubleBrewingGameSnapshotV1` remains unchanged.

Final validation: `quality` PASS; 321 source files scanned; typecheck PASS; Web client and both WeChat product shells build/verify PASS; 150 test files / 618 tests PASS. `BotcGameModule.ts` is 45,692 bytes, above the 40KB warning line but below the 50KB hard failure line; treat further growth as a bounded decomposition concern before/within PV-3B4 rather than expanding PV-3B3.

###### PV-3B4 — Spy Grimoire private-state presentation ✅ COMPLETE

Spy is now implemented as an explicit committed private-information family rather than by exposing `BotcModeratorView`:

- `TroubleBrewingSpyGrimoire` builds the truthful canonical Grimoire snapshot from authoritative assignments, seating order, life state and currently modeled reminder-token facts;
- the Spy snapshot includes actual/shown roles, alive/dead state, Drunk, Poisoner target, Butler master, Red Herring, and first-night Washerwoman/Librarian/Investigator reminder information; it excludes recommendation metadata, semantic-truth/reliability labels, histories, command/idempotency state and moderator controls;
- Spy reuses the same authoritative `commit -> private delivery -> recipient acknowledge -> advance` lifecycle as other night information, so reconnect/idempotency and Automatic Storyteller same-mutation auto-commit remain on existing production seams;
- a poisoned Spy still receives the truthful baseline Grimoire in `baseline_v1`, while authoritative history records `poisoned` reliability; future deceptive/fake-Grimoire quality policy is deferred to Recommendation/Storyteller policy rather than embedded in rendering;
- Trouble Brewing does not permit Drunk-shown-Spy because Drunk may only be shown a Townsfolk role; invalid test/branch semantics were explicitly rejected;
- dead actual Spy does not wake on later nights; the Spy's "even if dead" clause applies to registration, not to waking eligibility;
- ordinary players/public projection never receive the Spy Grimoire; shared `BotcGamePresentation` produces semantic Grimoire rows/reminder lines and both WeChat and Simulator remain thin renderers;
- bounded decomposition moved cohesive private-view ownership into `BotcPlayerPrivateViews.ts` and night-information orchestration into `BotcNightInformationRuntime.ts`. The source-size gate is back below warning level: 326 source files scanned, largest file `dev/labV2.js` at 34,129 bytes; `BotcGameModule.ts` is no longer the largest/over-40KB file.

Validation before merge: typecheck PASS; Web client and both WeChat product shells build/verify PASS; 152 test files / 622 tests PASS. `TroubleBrewingGameSnapshotV1` remains unchanged.

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

### PV-6 — WeChat Developer Tools platform parity

Only after the same application semantics and flows already pass in Simulator:

- verify the generated BotC WeChat shell renders the shared presentation states correctly in the real WXML/WXSS runtime;
- verify WeChat navigation/touch behavior that a browser mirror cannot prove;
- verify `wx` capability adapters such as vibration and lifecycle integration;
- exercise the deployed Cloudflare/public-network path when integration risk requires it;
- do **not** use this stage as the first place to discover ordinary room/game-flow defects; those belong to Simulator acceptance first;
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

Use only for vibration, WeChat lifecycle, real touch/layout/device behavior and network/platform issues that the Simulator cannot faithfully reproduce.

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

> **PV-4 — Minimal day / night loop.**

PV-3B4 now closes the remaining first-night Spy private-information shape and also extracts the night-information/private-view owners that had pushed `BotcGameModule.ts` above the source-size warning line. The next slice should add only the minimum repeated-play day/night state machine—nomination, voting, execution/death, next-night transition and the minimum dependent Trouble Brewing interactions—while continuing to use the existing authoritative RoomSnapshot/ClientSession/Simulator-first path.
