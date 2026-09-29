# my-game-host-vibration AI Development Instructions

> Role: **NORMATIVE / PROJECT-LEVEL AI WORKING AGREEMENT**  
> Effective: 2026-09-27  
> Applies to: ChatGPT, Codex/Luna, and other AI development agents working on this repository.

## 1. Authority and conflict resolution

Use this authority order:

```text
explicit current user instruction
-> AGENTS.md
-> 开发计划_V5_客户端运行时与网络韧性实施路线.md
-> docs/微信客户端大厅与方桌_UI实施基线_2026-09-28.md   // WeChat lobby/table UX only
-> 长期架构与DurableObjects迁移设计_V4.md
-> live code / Git / tests / runtime evidence
-> README.md operational instructions
-> Mini MCP developer memory
-> historical Git content / superseded documents
```

Interpret the documents narrowly:

- `开发计划_V5_客户端运行时与网络韧性实施路线.md` owns **current progress, current milestone, next implementation slice, and execution order**.
- `长期架构与DurableObjects迁移设计_V4.md` owns **long-term product boundaries and architecture principles**, not current milestone status when its historical implementation sequence conflicts with V5.
- `开发计划_V4_架构验证后实施路线.md` and `长期架构与DurableObjects迁移设计_V3.md` are historical/superseded references only.
- `README.md` is an **entry point and operational guide**. Its setup/run/test instructions may be authoritative when current, but its roadmap text must never override V5.
- Live repository/runtime evidence must be rechecked for mutable facts such as branch, HEAD, working tree, remote state, tests, PRs, and CI.
- Developer memory is advisory only and must never override current instructions, AGENTS, authoritative docs, or live evidence.

When two documents disagree, do not average them. Follow the owner defined above and, at a suitable checkpoint, remove or correct stale duplicated guidance.

## 2. Product goal and non-goals

This repository is an **online, multi-player, automatic-host system for in-person social deduction games**.

Current product priorities:

1. no human judge is required during normal play;
2. face-to-face discussion remains the primary social experience;
3. phones should require minimal attention;
4. private vibration / wake behavior should alert only players who need to act;
5. reconnect, app switching, screen lock, and network changes are normal lifecycle events;
6. the system owns authoritative game flow and secret information;
7. the host is primarily a recovery controller, not a hidden-information super-user;
8. Werewolf is the current production game. W3D3 + MG0 shared-infrastructure admission work is complete; Blood on the Clocktower / Trouble Brewing B0 is the active production-expansion mainline, with B0A module + setup/view contracts current.
9. The WeChat product direction is two game-specific thin-client shells — working names `骏骏桌游-狼人` and `骏骏桌游-血染` — over one shared client/runtime/backend platform. Do not duplicate reconnect, identity, transport, room, recovery, persistence, or Cloudflare authority code per mini program.
10. A room's `gameType` is fixed at room creation by the client product; the lobby no longer owns cross-game switching.

Do not turn this repository into a general game-platform framework before real product needs justify it.

Do not build a large generic rules DSL merely because BotC may need richer mechanics later.

## 3. Architecture ownership and dependency direction

Preserve the established dependency direction:

```text
core
  -> generic contracts only

domain
  -> legacy Werewolf state/mutations and generic pure support only
  -> frozen for new Werewolf semantics; retire incrementally

games/werewolf
  -> authoritative Werewolf rules, planning, timeout policy, metadata, and projections

games/botc
  -> authoritative BotC rules/state, setup/night sequencing, views, and BotC-specific interaction semantics
  -> B0 production entry is now active; add only concrete Trouble Brewing needs and do not prebuild a large generic rules DSL

GameCatalog / game admission seam
  -> selects the concrete GameModule from room.gameType
  -> platform/runtime code must not hard-code Werewolf once MG0 is complete

protocol/client
  -> versioned transport-neutral client contract

runtime/shared
  -> transport-neutral runtime composition

runtime/node
  -> Express / Socket.IO / Node capability adapter

runtime/cloudflare
  -> Worker / Durable Object / WebSocket capability adapter
```

Mandatory invariants:

- `core` must not depend on Express, Socket.IO, Cloudflare runtime types, or a specific game.
- new Werewolf rule semantics must not be added to the legacy global `domain/game.ts`; add them under the concrete Werewolf module and migrate touched legacy slices incrementally.
- non-game production code may type-import legacy Werewolf state types, but runtime rule values/mutations must flow through the `games/werewolf` ownership seam.
- concrete Werewolf state fields must not be mutated directly by runtime adapters.
- once BotC admission hardening begins, shared room/runtime code must not depend on concrete Werewolf state, config, interaction, error, lifecycle, or projection types; such dependencies belong behind the concrete game seam.
- Werewolf display metadata has one canonical owner: the role registry; server/runtime/view layers consume it rather than recreating parallel tables.
- game modules must not depend on Node/Cloudflare runtime adapters.
- game modules must not reverse-depend on the client protocol layer.
- `runtime/shared` must not depend on Node or Cloudflare adapters.
- Cloudflare runtime must not depend on the Node adapter.
- Node and Cloudflare client-protocol adapters must not depend on each other.
- stable player identity must not be represented by `socketId`.
- `commandId` is a transport/runtime idempotency concern.
- `actionId` / interaction identity is a game-interaction concurrency concern.
- retrying one user action must reuse the same `commandId`.
- authoritative state, private player view, recovery state, and secret information are server-owned.
- client/device vibration and audio are capability-adapter concerns, not GameModule side effects.
- PlayerView privacy boundaries must not be weakened for debugging or implementation convenience.

Do not create duplicate semantic owners. If responsibility moves to a new authoritative owner, remove or retire the old production owner in the same logical change when safe.

## 4. Relationship to CampBoardGameHost / ClockTower work

`CampBoardGameHost` and `my-game-host-vibration` are related products, not one runtime system.

```text
CampBoardGameHost
= offline Android human-host / storyteller tool

my-game-host-vibration
= online multi-phone automatic-host system
```

They may share or cross-inform:

- BotC role and script metadata;
- pure rules or algorithms;
- validated storyteller/recommendation logic;
- evidence-derived game semantics;
- stable domain knowledge that has a real shared owner.

They must not be unified merely for architectural symmetry.

Do not import Android UI/runtime ownership, offline Host state management, networking assumptions, persistence design, or project-specific composition boundaries into this repository unless the current product independently needs them.

**CampBoardGameHost may inform game semantics and algorithms, but it does not define this repository's runtime architecture.**

For BotC work, keep the runtime boundary explicit:

```text
Room Runtime
  -> membership / owner / identity / command / state / revision / persistence / delivery

BotC GameModule
  -> game semantics / setup / night sequencing / interactions / player-host-public views

BotC storyteller intelligence
  -> legal-information candidate generation / recommendation / trace / replay
```

Room Owner and Game Moderator/Storyteller are distinct authorities. A human BotC storyteller may require full game-secret visibility while the room owner remains a privacy-safe recovery/management role. Automatic storyteller mode is also distinct from room ownership.

Storyteller recommendation must remain a separate recommendation/intelligence layer and must not become Room Runtime policy.

## 5. Decision authority and AI division of work

Default collaboration model:

```text
ChatGPT / Chat
  = product semantics
  = architecture and ownership
  = scope / slice selection
  = public-contract decisions
  = test strategy and acceptance criteria
  = final diff / test / CI / result analysis

Mini MCP direct tools
  = normal repository inspection
  = search / bounded read / small safe patches
  = Git state / diff / stage / commit / push
  = configured task execution
  = GitHub control-plane operations when appropriate

Codex / Luna execution session
  = bounded local implementation mechanics
  = complete-file or cross-file mechanical changes
  = edit -> typecheck/test -> repair loops within approved semantics

GitHub
  = canonical remote repository / PR / CI state
  = independent remote acceptance evidence
```

Use three explicit local-model authority levels:

- **L2 — ChatGPT architecture authority:** owns semantics, architecture, scope, ownership, invariants, acceptance, and material plan changes.
- **L1 — strong Codex analysis:** optional when complete local context is materially required before Chat can safely choose a design. Use primarily for read-only analysis and return findings to Chat.
- **L0 — Luna mechanical execution:** default low-cost implementation mode after Chat has fixed the design.

L0/Luna may:

- navigate the approved scope;
- implement the specified design;
- make local type/compile fixes needed by that design;
- run approved tests;
- perform ordinary refactoring needed to complete the approved implementation.

L0/Luna must not independently:

- redesign architecture;
- change product semantics;
- broaden scope;
- choose a different public contract;
- replace the selected owner with a different owner because it is easier;
- silently add unrelated dependencies;
- approve its own final result.

If the real code makes the approved design materially ambiguous, return a decision-required result instead of inventing a new design.

## 6. Execution-path priority

Choose the simplest safe path.

### Path A — Mini MCP direct tools

Use for ordinary inspection, search, bounded reads, small/medium safe edits, Git review, configured validation, and repository lifecycle operations.

Preferred edit flow:

```text
search
-> bounded/full read as needed
-> expected revision
-> focused patch
-> diff review
-> focused validation
```

### Path B — Chat design -> isolated Codex/Luna execution

Use when:

- a file is large enough that bounded patching becomes unsafe or inefficient;
- implementation spans enough local context that a complete worktree view materially helps;
- repeated edit/test/fix loops are mechanical once semantics are fixed.

Chat must provide:

- bounded goal;
- authoritative inputs;
- required behavior;
- forbidden changes;
- acceptance criteria;
- test requirements;
- decision boundaries.

Execution completion is not acceptance. Chat reviews evidence/diff and explicitly accepts, requests revision, blocks, or asks for a decision.

### Path C — strong Codex read-only analysis

Use when Chat cannot safely determine ownership/design from available bounded context.

The output should be owner maps, code paths, constraints, risks, or a patch plan. Chat then chooses the design before implementation.

Do not move architecture authority to a cheaper local model merely because it can read more files.

## 7. Change pre-flight and shared-contract fan-out

Before modifying production behavior, identify:

1. change type: bug, new/changed behavior, refactor, ownership move, protocol change, presentation-only change, or mechanical cleanup;
2. authoritative owner;
3. durable behavior/invariant being changed or preserved;
4. narrowest reliable evidence;
5. affected producers/consumers if a shared contract changes.

For any shared contract, projection, protocol envelope, snapshot, player view, interaction type, persistence DTO, or cross-runtime model:

1. find all production producers / constructors / adapters / direct builders;
2. find all production consumers;
3. classify each path as **must inherit** or **intentionally exempt**;
4. prefer fixing the common semantic/projection/ownership boundary over caller-specific patches;
5. re-run the producer/consumer search after implementation.

This is especially important across:

```text
Web client
Node runtime
Cloudflare runtime
future WeChat shell
```

A fix is incomplete if only the path that exposed the defect is updated while an equivalent runtime/client path remains stale.

## 8. Abstraction discipline

Do not abstract merely because a future use case can be imagined.

Create or generalize an abstraction when at least one of these is true:

- there is a current second concrete use case;
- an already-accepted architecture invariant requires a stable seam;
- duplication is causing real semantic drift;
- testability/ownership is materially improved at the true responsibility boundary.

Avoid:

- speculative BotC framework layers;
- generic `utils.ts` dumping grounds;
- one-off adapter layers with no stable responsibility;
- parallel old/new production owners;
- framework rewrites unrelated to the current milestone;
- broad directory reshuffles for aesthetics.

File size is a review signal, not by itself an ownership rule.

## 9. Risk-based testing and evidence

Use **risk-based test-first development**, not mandatory RED ceremony for every source edit.

Default mapping:

```text
bug fix / new stable behavior / changed stable behavior
  -> smallest durable owning test when practical
  -> meaningful RED when executable
  -> implementation
  -> GREEN

protocol / snapshot / identity / reconnect / idempotency / privacy change
  -> contract or integration test at the true ownership boundary
  -> cross-runtime/client parity where applicable

behavior-preserving refactor / ownership extraction
  -> identify existing owning coverage
  -> establish useful GREEN baseline
  -> refactor
  -> rerun focused evidence
  -> add characterization only for a real gap

presentation-only / mechanical cleanup
  -> focused type/build/static/diff evidence
  -> do not manufacture a domain RED
```

Existing coverage can be valid test-first evidence.

Tests are maintained engineering assets, not an append-only archive. Retire or narrow tests when they only protect an obsolete implementation shape and the real contract is covered more directly elsewhere.

Do not add a production abstraction solely to satisfy a process requirement for a new test seam.

## 10. Local validation commands

The configured normal Mini MCP validation tasks are:

```text
typecheck    -> npm run typecheck
test         -> npm test
build:client -> npm run build:client
```

Choose the cheapest reliable evidence for the slice rather than mechanically running every command after every edit.

At logical checkpoints and before merge, ensure all validation relevant to the changed ownership boundary has passed.

### `verify:flow` special rule

`npm run verify:flow` is **not** a normal single-command Mini MCP verification gate.

It depends on a running server and connects to `127.0.0.1:3001` by default.

Use it only when the changed flow warrants runtime integration verification, with the required server lifecycle explicitly arranged. Do not interpret inability to run it as a normal configured-task failure.

## 11. Dependency and lockfile discipline

- Do not add a dependency without a concrete current use case.
- Prefer platform / standard-library capability when sufficient.
- Keep `package.json` and `package-lock.json` synchronized when dependency changes are intentional.
- Do not modify dependency files merely because an environment needs installation/bootstrap.
- When installing existing dependencies for validation, preserve the checked-in dependency graph unless an intentional dependency change is part of the approved scope.
- Never accept unrelated lockfile churn as incidental implementation noise.

## 12. Git and repository-state discipline

Before mutation, verify live branch / HEAD / working-tree state when it matters. Never assume a prior conversation checkpoint is still current.

Rules:

- do not overwrite, reset, or discard unrelated working-tree changes;
- review the exact diff before staging/commit;
- stage explicit intended paths only;
- keep commits focused on one logical slice;
- keep `main` runnable;
- use exact stale-state protections exposed by Mini MCP;
- GitHub is canonical remote truth;
- local execution success does not substitute for remote PR/CI acceptance when remote acceptance is part of the task.

Standing merge authorization (2026-09-29): once a PR for an accepted task has passed all required repository validation, is mergeable/clean, has no unresolved review threads, and the final diff remains within the accepted scope, merge it without asking the user for a separate per-PR authorization. Stop instead of merging when required checks fail or remain pending, mergeability is not clean, review threads remain unresolved, or the implementation has materially drifted beyond the accepted task.

## 13. Developer-memory workflow

Mini MCP developer memory is an **optional advisory aid**, not a mandatory startup ritual.

Good memory candidates:

- stable repository/ownership maps;
- accepted architecture decisions that constrain future work;
- recurring engineering lessons with causal value;
- intentional technical debt with a concrete revisit trigger;
- durable workflow rules;
- explicit user corrections that future work could otherwise repeat.

Do not store:

- branch HEADs;
- ordinary PR/CI status;
- every test result;
- transient task progress;
- full logs;
- copied documentation;
- secrets or credentials.

At meaningful checkpoints choose `ADD / UPDATE / SUPERSEDE / NONE`. `NONE` should remain common.

Mutable facts must still be verified live even when memory exists.

## 14. Documentation maintenance

Avoid multiple files owning the same changing fact.

When a milestone changes:

- update V5 for current progress / next slice;
- update long-term V4 only when long-term architecture changes;
- mark older V4-route / V3-architecture documents as superseded rather than letting them compete for current authority;
- update README when setup, operation, supported workflow, or its high-level status summary would otherwise mislead users;
- do not create a new roadmap document merely to restate V4.

Historical implementation plans inside otherwise-useful architecture documents must be clearly treated as historical when V4 has superseded them.

## 15. Definition of done for a slice

A slice is complete only when the applicable evidence is satisfied:

- intended owner/invariant is clear;
- no unintended duplicate production owner remains;
- all required producer/consumer paths were handled;
- focused tests/evidence pass;
- relevant `typecheck` / tests / client build pass;
- privacy, identity, reconnect, and idempotency boundaries remain intact when touched;
- exact diff contains only intended changes;
- remote state/CI is verified when required;
- V5/README/other docs are updated only when the milestone or operational truth changed;
- durable memory is added/updated only if the result is genuinely worth remembering.
