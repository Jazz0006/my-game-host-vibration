# B0B3 BotC Ownership Boundary Audit — 2026-09-30

## Purpose

B0A/B0B 已开始承载真实 Trouble Brewing 流程。B0B3 在继续接入动态夜间推进前，先把今天确定的长期 BotC 架构落实为代码 ownership，避免 `BotcGameModule` 逐步演变成阵容生成、规则、信息与推荐全部混合的大模块。

## Canonical ownership contract

```text
Setup Generation / Setup Contract
        ↓
Canonical Session / Truth
        ↓
Game Engine / BotcGameModule
        ↓
Rules / Information Resolution
        ↓
Recommendation Context Builder
        ↓
Storyteller Recommendation Engine
        ↓
chosen decision
        ↓
Game Engine authoritative commit
```

### 1. Setup Generation / Setup Contract

Owns:

- script / role legality;
- player-count and role-category setup constraints;
- Baron-style setup mutations;
- actual-role / shown-role setup invariants;
- future legal roster generation / candidate generation.

Does not own:

- day/night progression;
- ability resolution;
- information truth;
- storyteller-quality ranking.

Current owner:

```text
src/games/botc/TroubleBrewing.ts
src/games/botc/TroubleBrewingSetup.ts
```

`TroubleBrewingSetup.ts` validates/canonicalizes an already selected setup. It is not yet the future roster search/recommendation engine.

### 2. Canonical Session / Truth

Owns accepted authoritative facts only.

Current examples:

- canonical actual/shown assignment;
- phase/day/night number;
- death state;
- death-this-night fact;
- execution-and-death fact;
- already-resolved role-transition facts;
- night progression cursor.

Recommendation code may read these facts but may not write them directly.

### 3. Game Engine / `BotcGameModule`

Owns:

- command authorization/orchestration;
- phase transitions;
- calling the concrete setup/sequencing/rules owners;
- committing already accepted/resolved decisions;
- Player / Moderator / Public projection selection.

Does not own:

- setup search;
- role ability truth policy;
- poison/drunk information generation;
- registration choice;
- recommendation ranking.

B0A temporarily kept setup normalization inside `BotcGameModule`. The audit classifies that as acceptable bootstrap debt but not an acceptable long-term owner. B0B3 removes it.

### 4. Rules / Information Resolution

Future concrete Trouble Brewing owner for:

- role ability legality and effects;
- registration;
- poisoning / drunkenness truth handling;
- legal information candidates;
- deterministic rule-constrained state transitions.

It must not choose a candidate merely because it is more narratively interesting.

### 5. Storyteller Recommendation Engine

Future read-only recommendation owner.

Each request should identify:

- decision point;
- required context;
- optional/enrichment context;
- legal candidates supplied by setup or rules/information owners.

Output:

- ranked or otherwise selected recommendation candidates;
- rationale;
- DecisionTrace / replay evidence.

It does not mutate canonical state. Human or automatic storyteller selection returns to Game Engine, which performs the authoritative commit.

## B0A/B0B findings

### Finding A — setup validation was in the wrong long-term owner

Before B0B3, `BotcGameModule.normalizeAssignments` owned:

- player/assignment cardinality;
- duplicate role checks;
- Drunk actual/shown invariants;
- category-count validation.

This belongs to Setup Contract. B0B3 moves it to `TroubleBrewingSetup.ts` while keeping the existing create-game API stable.

### Finding B — sequencing has so far kept the correct boundary

`TroubleBrewingNightSequence.ts` already accepts authoritative facts and owns ordering/eligibility only.

It does not decide:

- why a player died;
- why a role transition occurred;
- what information is true/false;
- which legal information should be preferred.

Keep this property.

### Finding C — a frozen filtered-list index would violate live-state semantics

Other-night eligibility changes while the night is running. Example:

```text
Imp action active
  -> authoritative Rules owner resolves Ravenkeeper death
  -> Ravenkeeper becomes eligible later in the same night
```

A pre-filtered array plus numeric index cannot safely represent this.

B0B3 therefore uses:

- a canonical Trouble Brewing slot order;
- a monotonic completed-through identity;
- an active-step snapshot;
- re-evaluation from fresh authoritative facts only after the active step completes.

This permits newly eligible later steps without replaying earlier steps.

### Finding D — do not add fact-injection commands as scaffolding

B0B3 must not add moderator commands such as:

```text
injectDeath
injectExecution
injectRoleTransition
```

solely to make sequencing tests possible.

Tests may directly construct/mutate authoritative state to stand in for the future Rules/Information owner. Production mutation will later come from the real rule owner.

## Current code ownership after B0B3 hardening

```text
TroubleBrewing.ts
  -> script/role metadata + setup-count rules

TroubleBrewingSetup.ts
  -> accepted setup validation/canonicalization

TroubleBrewingNightSequence.ts
  -> first/other-night canonical ordering + eligibility from authoritative facts

TroubleBrewingNightProgression.ts
  -> live monotonic other-night cursor + active-step snapshot

BotcGameModule.ts
  -> authoritative session + phase/command orchestration + views

B0C+ Rules / Information owner
  -> NOT YET IMPLEMENTED

B0C+ Storyteller Recommendation owner
  -> NOT YET IMPLEMENTED
```

## B0B3 acceptance gates

- setup validation no longer implemented inside `BotcGameModule`;
- other-night progression re-evaluates fresh facts after every completed step;
- Ravenkeeper can become newly eligible after the Imp step without replaying Poisoner/Monk/Imp;
- active step cannot be silently replaced by a live-state change mid-action;
- role-change notification visible only to its actor and moderator;
- PublicView remains secret-safe;
- no arbitrary fact-injection production command;
- no information generation or recommendation ranking enters sequencing;
- full typecheck and test suite GREEN before merge.
